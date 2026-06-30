import { getSupabaseAdmin } from "./supabase";
import { sendTenantMessageByPhone } from "./whatsapp";
import { getRandomDelay } from "./whatsapp-anti-fingerprint";
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

type NotificationRow = {
  id: string;
  business_id: string;
  message: string;
  attempts: number;
  staff_id?: string;
  client_id?: string;
};

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

async function processNotification(config: QueueConfig, row: NotificationRow): Promise<void> {
  const businessId = row.business_id;

  const tenantId = await resolveTenantId(businessId);
  if (!tenantId) {
    // Misconfiguration, not a transient send issue — fail without retrying or pausing.
    await markFailed(config, row.id, (row.attempts ?? 0) + 1, "Could not resolve tenant for business");
    return;
  }

  const recipientId = (row[config.recipientColumn] as string | undefined) ?? "";
  const phone = await getRecipientPhone(config, recipientId);
  if (!phone) {
    await markFailed(config, row.id, (row.attempts ?? 0) + 1, "Recipient has no phone");
    return;
  }

  try {
    await sendTenantMessageByPhone(tenantId, phone, row.message);
    await markSent(config, row.id, (row.attempts ?? 0) + 1);
    await recordSuccess(businessId);
    logger.info({ notificationId: row.id }, `${config.logPrefix} Sent successfully`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const attempts = (row.attempts ?? 0) + 1;
    const permanent = isPermanentSendError(errorMessage);

    if (permanent) {
      // Bad number: never retries, and not a session problem so it must not pause the business.
      await markFailed(config, row.id, attempts, errorMessage);
    } else if (!isPreDispatchFailure(errorMessage)) {
      // The message was already handed to whatsapp-web.js, which then threw —
      // almost always an ACK timeout on a message that was in fact delivered.
      // Retrying would re-deliver it (the duplicate-confirmation bug), so we treat
      // an attempted send as delivered (at-most-once) instead of re-sending.
      await markSent(config, row.id, attempts);
      await recordSuccess(businessId);
      logger.warn(
        { notificationId: row.id, error: errorMessage },
        `${config.logPrefix} Send threw after dispatch — assuming delivered, not retrying`,
      );
      return;
    } else if (attempts >= MAX_ATTEMPTS) {
      // Genuinely never dispatched (e.g. session down) and out of retries.
      await markFailed(config, row.id, attempts, errorMessage);
      await recordFailure(businessId, errorMessage);
    } else {
      // Genuinely never dispatched — safe to retry.
      await scheduleRetry(config, row.id, attempts, errorMessage);
      await recordFailure(businessId, errorMessage);
    }

    logger.error({ notificationId: row.id, attempts, permanent, error: errorMessage }, `${config.logPrefix} Send failed`);
  }
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

    const pausedIds = await getPausedBusinessIds();
    const rows = (data as NotificationRow[]).filter((r) => !pausedIds.has(r.business_id));
    if (rows.length === 0) return;

    logger.info({ count: rows.length }, `${config.logPrefix} Processing`);

    for (const row of rows) {
      await processNotification(config, row);
      // Light jitter so a burst of reminders doesn't go out at a robotic fixed interval.
      await new Promise((resolve) => setTimeout(resolve, getRandomDelay(1, 3)));
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
