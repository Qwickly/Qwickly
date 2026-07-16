import { getSupabaseAdmin } from "./supabase";
import { sendTenantMessageByPhone } from "./whatsapp";
import { getRandomDelay } from "./whatsapp-anti-fingerprint";
import { isEmailConfigured, sendEmail, subjectForType } from "./email-sender";
import { hasGrant } from "./entitlements";
import { logger } from "./logger";

/**
 * Unified background worker for the staff_notifications and client_notifications
 * queues (migrations 014 / 015 / 024). Both queues share the same shape, so the
 * processing logic lives here once instead of being copy-pasted into two files.
 *
 * Adds over the original per-queue workers:
 *  - retry with backoff (attempts + next_attempt_at) so a transient WhatsApp
 *    hiccup no longer drops a message permanently;
 *  - transient-vs-permanent failure classification (a missing phone is never
 *    retried; a send error is);
 *  - per-business auto-pause when sends keep failing (likely a disconnected
 *    session) so we stop hammering and spamming logs, then auto-resume;
 *  - light per-message jitter to avoid robotic fixed-interval bursts.
 */

type QueueConfig = {
  table: "staff_notifications" | "client_notifications";
  recipientColumn: "staff_id" | "client_id";
  recipientTable: "staff_members" | "clients";
  /** Client reminders carry a future scheduled_at; staff alerts send immediately. */
  respectScheduledAt: boolean;
  logPrefix: string;
};

const STAFF_QUEUE: QueueConfig = {
  table: "staff_notifications",
  recipientColumn: "staff_id",
  recipientTable: "staff_members",
  respectScheduledAt: false,
  logPrefix: "[Staff Notifications]",
};

const CLIENT_QUEUE: QueueConfig = {
  table: "client_notifications",
  recipientColumn: "client_id",
  recipientTable: "clients",
  respectScheduledAt: true,
  logPrefix: "[Client Notifications]",
};

// Give up (mark failed) after this many tries; back off in between.
const MAX_ATTEMPTS = 4;
// Consecutive failed sends for one business before we pause its queue.
const PAUSE_FAILURE_THRESHOLD = 5;
const PAUSE_MINUTES = 10;
// Cap rows processed per queue per run so one big batch can't block forever.
const MAX_PER_RUN = 100;
// How long a claimed row is leased. While leased, overlapping ticks and other
// server instances skip it; if this worker dies mid-send the lease expires and
// the row becomes eligible again (self-healing). Must comfortably exceed a
// single send; real sends take seconds, so 2 minutes is generous.
const CLAIM_LEASE_MS = 2 * 60_000;

type NotificationRow = {
  id: string;
  business_id: string;
  message: string;
  attempts: number;
  staff_id?: string;
  client_id?: string;
  booking_id?: string;
  /** Only present on client_notifications; defaults to whatsapp. */
  channel?: "whatsapp" | "email";
  notification_type?: string;
};

// Booking notification types that should carry the "Manage booking" magic link
// (view/cancel/reschedule). Cancellation + review emails deliberately don't.
const MANAGE_LINK_TYPES = new Set([
  "booking_confirmations",
  "reminder_24h",
  "reminder_2h",
  "rescheduling_alerts",
]);

/**
 * Build the per-booking "Manage booking" link for an email, or undefined when it
 * doesn't apply (non-booking type, no booking, or APP_BASE_URL not configured).
 * The token is the unguessable bookings.manage_token from migration 045.
 */
async function getManageUrl(row: NotificationRow): Promise<string | undefined> {
  const base = process.env["APP_BASE_URL"]?.trim().replace(/\/$/, "");
  if (!base || !row.booking_id || !MANAGE_LINK_TYPES.has(row.notification_type ?? "")) {
    return undefined;
  }
  try {
    const { data } = await getSupabaseAdmin()
      .from("bookings")
      .select("manage_token")
      .eq("id", row.booking_id)
      .maybeSingle();
    const token = data?.manage_token as string | undefined;
    return token ? `${base}/booking/manage/${token}` : undefined;
  } catch (err) {
    logger.error({ err }, "[Client Notifications] Error building manage URL");
    return undefined;
  }
}

/** Minutes to wait before the next try, given the attempt that just failed. */
function backoffMinutes(attempts: number): number {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  return 15;
}

// A send error we know won't fix itself on retry (bad/unregistered number).
function isPermanentSendError(message: string): boolean {
  return /not a registered WhatsApp number/i.test(message);
}

// Errors thrown BEFORE the message was handed to WhatsApp — nothing went out, so
// retrying is safe and necessary. Everything else thrown by the send path means
// whatsapp-web.js already dispatched the message and then threw (almost always an
// ACK timeout): the message WAS delivered, so a retry would duplicate it. We use
// this to keep retries for genuine failures while never re-delivering a message.
function isPreDispatchFailure(message: string): boolean {
  return /client is not connected/i.test(message)
    || /no phone/i.test(message)
    || /Message or image is required/i.test(message);
}

// ── tenant resolution (cached) ───────────────────────────────────────────────

const tenantCache = new Map<string, { tenantId: string | null; expires: number }>();
const TENANT_TTL_MS = 5 * 60_000;

async function resolveTenantId(businessId: string): Promise<string | null> {
  const cached = tenantCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.tenantId;

  let tenantId: string | null = null;
  try {
    const { data: business } = await getSupabaseAdmin()
      .from("businesses")
      .select("user_id")
      .eq("id", businessId)
      .maybeSingle();

    if (business?.user_id) {
      const { data: tenant } = await getSupabaseAdmin()
        .from("tenants")
        .select("id")
        .eq("owner_user_id", business.user_id)
        .maybeSingle();
      tenantId = tenant?.id ?? null;
    }
  } catch (err) {
    logger.error({ err }, "[Notifications] Error resolving tenant for business");
    return null; // don't cache an error
  }

  tenantCache.set(businessId, { tenantId, expires: Date.now() + TENANT_TTL_MS });
  return tenantId;
}

async function getRecipientPhone(config: QueueConfig, recipientId: string): Promise<string | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from(config.recipientTable)
      .select("phone")
      .eq("id", recipientId)
      .maybeSingle();
    return (data?.phone as string | undefined) || null;
  } catch (err) {
    logger.error({ err }, `${config.logPrefix} Error getting recipient phone`);
    return null;
  }
}

// Email recipient — reads the queue's recipient table (clients OR staff_members),
// both of which have an `email` column. Lets staff be emailed, not just clients.
async function getRecipientEmail(config: QueueConfig, recipientId: string): Promise<string | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from(config.recipientTable)
      .select("email")
      .eq("id", recipientId)
      .maybeSingle();
    const email = (data?.email as string | undefined)?.trim();
    return email || null;
  } catch (err) {
    logger.error({ err }, `${config.logPrefix} Error getting recipient email`);
    return null;
  }
}

// Business name/email feed the email's From display name and Reply-To; cached
// like tenant lookups. Name → "<business> via Qwickly"; email → Reply-To so
// customer replies reach the provider directly.
type BusinessContact = { name?: string; email?: string };
const businessContactCache = new Map<string, { contact: BusinessContact | null; expires: number }>();

async function getBusinessContact(businessId: string): Promise<BusinessContact> {
  const cached = businessContactCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.contact ?? {};

  let contact: BusinessContact | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("businesses")
      .select("business_name, email")
      .eq("id", businessId)
      .maybeSingle();
    contact = {
      name: (data?.business_name as string | undefined)?.trim() || undefined,
      email: (data?.email as string | undefined)?.trim() || undefined,
    };
  } catch (err) {
    logger.error({ err }, "[Client Notifications] Error getting business contact");
    return {}; // don't cache an error
  }

  businessContactCache.set(businessId, { contact, expires: Date.now() + TENANT_TTL_MS });
  return contact ?? {};
}

// A business's VERIFIED custom sending domain (Stage 2), resolved to a full From
// address like "bookings@salon.co.za". Only a row with status='verified' counts —
// pending/failed domains must never send, so we filter on it here. Cached like
// the other per-business lookups. Returns undefined when there's no verified
// custom domain, which keeps Stage 1 Qwickly-domain sending.
const senderDomainCache = new Map<string, { fromAddress: string | null; expires: number }>();

async function getVerifiedSenderAddress(businessId: string): Promise<string | undefined> {
  if (!(await hasGrant(businessId, "branded_email"))) {
    return undefined;
  }

  const cached = senderDomainCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.fromAddress ?? undefined;

  let fromAddress: string | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("email_domains")
      .select("domain, from_local_part, status")
      .eq("business_id", businessId)
      .eq("status", "verified")
      .maybeSingle();
    if (data?.domain && data?.from_local_part) {
      fromAddress = `${data.from_local_part}@${data.domain}`;
    }
  } catch (err) {
    logger.error({ err }, "[Client Notifications] Error getting verified sender domain");
    return undefined; // don't cache an error
  }

  senderDomainCache.set(businessId, { fromAddress, expires: Date.now() + TENANT_TTL_MS });
  return fromAddress ?? undefined;
}

// The business's booking-page brand colour, used for the email header + button so
// the email matches their booking page. Cached like the other per-business lookups.
const brandColorCache = new Map<string, { color: string | null; expires: number }>();

async function getBrandColor(businessId: string): Promise<string | undefined> {
  const cached = brandColorCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.color ?? undefined;

  let color: string | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("booking_page_settings")
      .select("primary_color")
      .eq("business_id", businessId)
      .maybeSingle();
    color = (data?.primary_color as string | undefined)?.trim() || null;
  } catch (err) {
    logger.error({ err }, "[Client Notifications] Error getting brand color");
    return undefined; // don't cache an error
  }

  brandColorCache.set(businessId, { color, expires: Date.now() + TENANT_TTL_MS });
  return color ?? undefined;
}

// ── per-business pause state ──────────────────────────────────────────────────

async function getPausedBusinessIds(): Promise<Set<string>> {
  const { data } = await getSupabaseAdmin()
    .from("notification_send_state")
    .select("business_id")
    .gt("paused_until", new Date().toISOString());
  return new Set((data ?? []).map((r) => r.business_id as string));
}

async function recordSuccess(businessId: string): Promise<void> {
  await getSupabaseAdmin()
    .from("notification_send_state")
    .upsert(
      {
        business_id: businessId,
        consecutive_failures: 0,
        paused_until: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
}

async function recordFailure(businessId: string, errorMessage: string): Promise<void> {
  const { data } = await getSupabaseAdmin()
    .from("notification_send_state")
    .select("consecutive_failures")
    .eq("business_id", businessId)
    .maybeSingle();

  const failures = (data?.consecutive_failures ?? 0) + 1;
  const pausedUntil =
    failures >= PAUSE_FAILURE_THRESHOLD
      ? new Date(Date.now() + PAUSE_MINUTES * 60_000).toISOString()
      : null;

  await getSupabaseAdmin()
    .from("notification_send_state")
    .upsert(
      {
        business_id: businessId,
        consecutive_failures: failures,
        paused_until: pausedUntil,
        last_error: errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );

  if (pausedUntil) {
    logger.warn(
      `[Notifications] Paused business ${businessId} for ${PAUSE_MINUTES}m after ${failures} consecutive failures`,
    );
  }
}

// ── notification row state transitions ────────────────────────────────────────

async function markSent(config: QueueConfig, id: string, attempts: number): Promise<void> {
  await getSupabaseAdmin()
    .from(config.table)
    .update({ status: "sent", attempts, error_message: null, next_attempt_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function markFailed(config: QueueConfig, id: string, attempts: number, errorMessage: string): Promise<void> {
  await getSupabaseAdmin()
    .from(config.table)
    .update({ status: "failed", attempts, error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function scheduleRetry(config: QueueConfig, id: string, attempts: number, errorMessage: string): Promise<void> {
  const nextAttemptAt = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
  await getSupabaseAdmin()
    .from(config.table)
    .update({ attempts, next_attempt_at: nextAttemptAt, error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// ── core processing ───────────────────────────────────────────────────────────

/**
 * Atomically claim a row before doing any work. The conditional UPDATE only
 * matches while the row is still pending AND due, so if an overlapping tick (or
 * another server instance) already claimed it, this matches zero rows and we
 * skip — the guarantee that a message is dispatched at most once. Claiming
 * leases next_attempt_at into the future; a successful send clears it
 * (markSent) and a genuine failure reschedules it (scheduleRetry). If we crash
 * after claiming, the lease simply expires and the row is retried later.
 */
async function claimNotification(config: QueueConfig, row: NotificationRow): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from(config.table)
    .update({ next_attempt_at: leaseUntil, updated_at: nowIso })
    .eq("id", row.id)
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .select("id")
    .maybeSingle();

  if (error) {
    logger.error({ err: error, notificationId: row.id }, `${config.logPrefix} Failed to claim row`);
    return false;
  }
  return Boolean(data);
}

/**
 * Send an already-claimed email notification. Reuses the same status/backoff
 * machinery as WhatsApp but deliberately skips tenant resolution and the
 * per-business pause tracking (recordSuccess/recordFailure) — those model
 * WhatsApp session health, which is irrelevant to email delivery.
 */
async function processEmailNotification(config: QueueConfig, row: NotificationRow): Promise<boolean> {
  const recipientId = (row[config.recipientColumn] as string | undefined) ?? "";
  const email = await getRecipientEmail(config, recipientId);
  if (!email) {
    // Missing address won't fix itself on retry — permanent, no pause.
    await markFailed(config, row.id, (row.attempts ?? 0) + 1, "Recipient has no email");
    return false;
  }

  if (!isEmailConfigured()) {
    // Provider not wired up yet (no RESEND_API_KEY) — retry later rather than
    // burning the row, so queued email survives until config lands.
    await scheduleRetry(config, row.id, (row.attempts ?? 0) + 1, "Email provider not configured");
    return true;
  }

  try {
    const { name: fromName, email: replyTo } = await getBusinessContact(row.business_id);
    const fromOverride = await getVerifiedSenderAddress(row.business_id);
    const manageUrl = await getManageUrl(row);
    const brandColor = await getBrandColor(row.business_id);
    await sendEmail({
      to: email,
      subject: subjectForType(row.notification_type ?? ""),
      text: row.message,
      fromName,
      replyTo,
      fromOverride,
      manageUrl,
      brandColor,
      // White-label (drop the Qwickly footer) only when sending from the
      // business's own verified domain — that's the paid tier.
      whiteLabel: Boolean(fromOverride),
    });
    await markSent(config, row.id, (row.attempts ?? 0) + 1);
    logger.info({ notificationId: row.id }, `${config.logPrefix} Email sent successfully`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const attempts = (row.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await markFailed(config, row.id, attempts, errorMessage);
    } else {
      await scheduleRetry(config, row.id, attempts, errorMessage);
    }
  }

  return true;
}

/** Returns true if a send was actually attempted (used to gate the send jitter). */
async function processNotification(config: QueueConfig, row: NotificationRow): Promise<boolean> {
  const businessId = row.business_id;

  // Claim first so overlapping ticks / other instances can't double-send this row.
  const claimed = await claimNotification(config, row);
  if (!claimed) return false;

  // Email rows take a separate path — no WhatsApp tenant/session, and email
  // failures must not trip the per-business pause that guards the WhatsApp queue.
  if (row.channel === "email") {
    return await processEmailNotification(config, row);
  }

  const tenantId = await resolveTenantId(businessId);
  if (!tenantId) {
    // Misconfiguration, not a transient send issue — fail without retrying or pausing.
    await markFailed(config, row.id, (row.attempts ?? 0) + 1, "Could not resolve tenant for business");
    return false;
  }

  const recipientId = (row[config.recipientColumn] as string | undefined) ?? "";
  const phone = await getRecipientPhone(config, recipientId);
  if (!phone) {
    await markFailed(config, row.id, (row.attempts ?? 0) + 1, "Recipient has no phone");
    return false;
  }

  try {
    await sendTenantMessageByPhone(tenantId, phone, row.message);
    await markSent(config, row.id, (row.attempts ?? 0) + 1);
    await recordSuccess(businessId);
    logger.info({ notificationId: row.id }, `${config.logPrefix} Sent successfully`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const attempts = (row.attempts ?? 0) + 1;
    const permanent = isPermanentSendError(errorMessage) || errorMessage.includes("Cannot send to this contact");

    if (permanent) {
      await markFailed(config, row.id, attempts, errorMessage);
      logger.warn(`${config.logPrefix} Permanent failure (new contact or invalid number):`, errorMessage);
    } else if (attempts >= MAX_ATTEMPTS) {
      await markFailed(config, row.id, attempts, errorMessage);
      await recordFailure(businessId, errorMessage);
    } else {
      await scheduleRetry(config, row.id, attempts, errorMessage);
      await recordFailure(businessId, errorMessage);
    }
  }

  // A send was attempted (delivered, retried, or failed) — signal so the caller
  // applies the anti-fingerprint jitter only after real dispatches.
  return true;
}

async function processQueue(config: QueueConfig): Promise<void> {
  try {
    const nowIso = new Date().toISOString();

    let query = getSupabaseAdmin()
      .from(config.table)
      .select("*")
      .eq("status", "pending")
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order("scheduled_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (config.respectScheduledAt) {
      query = query.lte("scheduled_at", nowIso);
    }

    const { data, error } = await query;
    if (error) {
      logger.error({ error }, `${config.logPrefix} Failed to fetch notifications`);
      return;
    }
    if (!data || data.length === 0) return;

    // The per-business pause models WhatsApp session health (a disconnected
    // session fails every send, so we stop hammering it). Email is an
    // independent channel that has nothing to do with that session, so a
    // WhatsApp-induced pause must not freeze email rows — only WhatsApp/staff
    // rows respect the pause. Without this, one dead WhatsApp session silently
    // blocks a business's email notifications too.
    const pausedIds = await getPausedBusinessIds();
    const rows = (data as NotificationRow[]).filter(
      (r) => r.channel === "email" || !pausedIds.has(r.business_id),
    );
    if (rows.length === 0) return;

    logger.info({ count: rows.length }, `${config.logPrefix} Processing`);

    for (const row of rows) {
      const dispatched = await processNotification(config, row);
      // Light jitter so a burst of reminders doesn't go out at a robotic fixed
      // interval — but only after a real dispatch. Rows an overlapping tick
      // already claimed return false, so a losing tick drains fast instead of
      // sleeping 1–3s per row it didn't send.
      if (dispatched) {
        await new Promise((resolve) => setTimeout(resolve, getRandomDelay(1, 3)));
      }
    }
  } catch (err) {
    logger.error({ err }, `${config.logPrefix} Error in queue processor`);
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export async function processStaffNotifications(): Promise<void> {
  await processQueue(STAFF_QUEUE);
}

export async function processClientNotifications(): Promise<void> {
  await processQueue(CLIENT_QUEUE);
}

/**
 * Start the background worker that drains both notification queues on an interval.
 */
export function startNotificationWorkers(interval: number = 10000): NodeJS.Timeout {
  logger.info({ intervalMs: interval }, "[Notifications] Starting background worker");

  return setInterval(async () => {
    await processQueue(STAFF_QUEUE);
    await processQueue(CLIENT_QUEUE);
  }, interval);
}
