import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";
import { getOfficialSender, type PlatformNotificationSend } from "./official-sender";
import { getRandomDelay } from "./whatsapp-anti-fingerprint";
import { logger } from "./logger";

/**
 * Background worker for platform → owner WhatsApp notifications (migration 027),
 * sent from the official Qwickly number via official-sender.ts. Distinct from
 * the per-tenant whatsapp-web.js sessions in whatsapp.ts.
 *
 * The send queue (platform_whatsapp_notifications) is generic, keyed by `kind`:
 *   'approval_alert'  — a 2-step AI reply is waiting for approval (built here).
 *   'revenue_summary' / 'ai_summary' / 'report' — future; their own producers
 *                        enqueue rows, and the generic drain below sends them.
 *
 * Each tick runs two phases:
 *   1. enqueue (approval_alert) — tally pending whatsapp_ai_drafts per business
 *      and, subject to opt-in + cooldown + quiet hours + a daily cap, enqueue ONE
 *      batched alert. A partial unique index on (business_id, kind) plus the
 *      cooldown collapse a burst of inbound client messages into a single "N
 *      waiting" ping instead of one per draft.
 *   2. drain (all kinds) — send pending rows through the official sender with
 *      retry/backoff. Approval-alert rows additionally re-check the live pending
 *      count (don't nag about a queue the owner already cleared) and advance the
 *      per-business throttle state.
 *
 * Anti-spam is layered: batching (here) + cooldown + quiet hours + daily cap +
 * the Cloud API's own template/rate governance (official-sender.ts).
 */

// Minimum gap between owner approval pings for a business (no new-draft pressure).
const COOLDOWN_MINUTES = 25;
// Allow an earlier re-ping when NEW drafts have arrived since the last ping,
// but never tighter than this so growth can't turn into a burst.
const MIN_REPING_GAP_MINUTES = 5;
// Safety ceiling on approval pings per business per SAST day.
const MAX_PINGS_PER_DAY = 12;
// Send retry budget per row before giving up.
const MAX_ATTEMPTS = 4;
// Cap rows sent per drain pass so one batch can't block the loop.
const MAX_PER_RUN = 50;
// Only businesses in a review mode produce drafts; guard anyway.
const REVIEW_MODES = new Set(["draft_only", "approval_required"]);

const APPROVAL_ALERT = "approval_alert";
const SAST_TZ = "Africa/Johannesburg";

const APP_BASE_URL = (process.env["APP_PUBLIC_URL"]?.trim() || "https://qwickly.co.za").replace(/\/+$/, "");
const HUB_URL = `${APP_BASE_URL}/whatsapp`;

// ── time helpers (South Africa, UTC+2, no DST) ───────────────────────────────

/** Current SAST time as minutes since midnight (0–1439). */
function sastMinutesOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: SAST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** Today's date in SAST as YYYY-MM-DD, for the per-day ping cap. */
function sastDateKey(now: Date): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: SAST_TZ }).format(now);
}

/** Parse a "HH:MM[:SS]" time column into minutes since midnight. */
function timeStrToMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m ?? "0");
}

/** Quiet window may cross midnight (e.g. 21:00 → 07:00). */
function isWithinQuietHours(now: Date, startStr: string, endStr: string): boolean {
  const cur = sastMinutesOfDay(now);
  const start = timeStrToMinutes(startStr);
  const end = timeStrToMinutes(endStr);
  if (start === end) return false; // empty window
  return start > end ? cur >= start || cur < end : cur >= start && cur < end;
}

/** Local SA normalisation: 0XXXXXXXXX → 27XXXXXXXXX; otherwise digits only. */
function toMsisdn(phone: string | null | undefined): string {
  let digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `27${digits.slice(1)}`;
  }
  return digits;
}

function backoffMinutes(attempts: number): number {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  return 15;
}

// ── types ────────────────────────────────────────────────────────────────────

type BotSettingsRow = {
  business_id: string;
  review_mode: string | null;
  owner_review_alerts_enabled: boolean | null;
  owner_alert_phone: string | null;
  owner_alert_quiet_start: string | null;
  owner_alert_quiet_end: string | null;
};

type StateRow = {
  business_id: string;
  last_pinged_at: string | null;
  last_pinged_count: number;
  pings_today: number;
  pings_day: string | null;
  snoozed_until: string | null;
};

type NotificationRow = {
  id: string;
  business_id: string;
  kind: string;
  to_phone: string;
  message: string;
  template_name: string | null;
  template_params: string[] | null;
  attempts: number;
};

// ── phase 1: enqueue approval alerts ─────────────────────────────────────────

/** Tally pending drafts per business. Returns business_id → pending count. */
async function tallyPendingDrafts(): Promise<Map<string, number>> {
  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_ai_drafts")
    .select("business_id")
    .eq("status", "pending");

  const counts = new Map<string, number>();
  if (error) {
    logger.error({ error }, "[Qwickly Notify] failed to tally pending drafts");
    return counts;
  }
  for (const row of (data ?? []) as Array<{ business_id: string }>) {
    counts.set(row.business_id, (counts.get(row.business_id) ?? 0) + 1);
  }
  return counts;
}

async function loadBotSettings(businessIds: string[]): Promise<Map<string, BotSettingsRow>> {
  const map = new Map<string, BotSettingsRow>();
  if (businessIds.length === 0) return map;
  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_bot_settings")
    .select(
      "business_id, review_mode, owner_review_alerts_enabled, owner_alert_phone, owner_alert_quiet_start, owner_alert_quiet_end",
    )
    .in("business_id", businessIds);
  if (error) {
    logger.error({ error }, "[Qwickly Notify] failed to load bot settings");
    return map;
  }
  for (const row of (data ?? []) as BotSettingsRow[]) map.set(row.business_id, row);
  return map;
}

async function loadStates(businessIds: string[]): Promise<Map<string, StateRow>> {
  const map = new Map<string, StateRow>();
  if (businessIds.length === 0) return map;
  const { data, error } = await getSupabaseAdmin()
    .from("owner_approval_alert_state")
    .select("*")
    .in("business_id", businessIds);
  if (error) {
    logger.error({ error }, "[Qwickly Notify] failed to load alert state");
    return map;
  }
  for (const row of (data ?? []) as StateRow[]) map.set(row.business_id, row);
  return map;
}

/**
 * Resolve where to ping the owner: explicit override → the number they already
 * run WhatsApp on (connected session) → the business contact phone.
 */
async function resolveOwnerPhone(businessId: string, override: string | null): Promise<string> {
  const direct = toMsisdn(override);
  if (direct) return direct;

  const { data: business } = await getSupabaseAdmin()
    .from("businesses")
    .select("user_id, phone")
    .eq("id", businessId)
    .maybeSingle();

  if (business?.user_id) {
    const { data: tenant } = await getSupabaseAdmin()
      .from("tenants")
      .select("id")
      .eq("owner_user_id", business.user_id)
      .maybeSingle();
    if (tenant?.id) {
      const { data: session } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .select("connected_phone")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      const connected = toMsisdn(session?.connected_phone as string | undefined);
      if (connected) return connected;
    }
  }

  return toMsisdn(business?.phone as string | undefined);
}

/** Decide whether this business is due for an approval ping right now. */
function isDue(now: Date, count: number, settings: BotSettingsRow, state: StateRow | undefined): boolean {
  if (!REVIEW_MODES.has(settings.review_mode ?? "auto")) return false;
  if (settings.owner_review_alerts_enabled === false) return false;

  if (state?.snoozed_until && new Date(state.snoozed_until) > now) return false;

  if (
    isWithinQuietHours(
      now,
      settings.owner_alert_quiet_start ?? "21:00",
      settings.owner_alert_quiet_end ?? "07:00",
    )
  ) {
    return false;
  }

  // Daily cap (per SAST day).
  if (state && state.pings_day === sastDateKey(now) && state.pings_today >= MAX_PINGS_PER_DAY) {
    return false;
  }

  if (!state?.last_pinged_at) return true;

  const minsSince = (now.getTime() - new Date(state.last_pinged_at).getTime()) / 60_000;
  if (minsSince >= COOLDOWN_MINUTES) return true;
  // New drafts since last ping → allow an earlier nudge, but not too soon.
  if (count > state.last_pinged_count && minsSince >= MIN_REPING_GAP_MINUTES) return true;
  return false;
}

function renderApprovalAlert(count: number): { message: string; templateParams: string[] } {
  const noun = count === 1 ? "client reply" : "client replies";
  return {
    message: `You have ${count} ${noun} waiting for approval in Qwickly. Open the WhatsApp Hub: ${HUB_URL}`,
    // Approved utility template body variables, in order: {{1}} count, {{2}} link.
    templateParams: [String(count), HUB_URL],
  };
}

async function enqueueDueApprovalAlerts(now: Date): Promise<void> {
  const counts = await tallyPendingDrafts();
  if (counts.size === 0) return;

  const businessIds = [...counts.keys()];
  const [settingsMap, stateMap] = await Promise.all([
    loadBotSettings(businessIds),
    loadStates(businessIds),
  ]);

  for (const [businessId, count] of counts) {
    const settings = settingsMap.get(businessId);
    if (!settings) continue;
    if (!isDue(now, count, settings, stateMap.get(businessId))) continue;

    const toPhone = await resolveOwnerPhone(businessId, settings.owner_alert_phone);
    if (!toPhone) {
      logger.warn({ businessId }, "[Qwickly Notify] no owner phone to alert — skipping");
      continue;
    }

    const { message, templateParams } = renderApprovalAlert(count);
    const sender = getOfficialSender();

    const { error } = await getSupabaseAdmin().from("platform_whatsapp_notifications").insert({
      business_id: businessId,
      kind: APPROVAL_ALERT,
      to_phone: toPhone,
      message,
      template_params: templateParams,
      metadata: { pending_count: count },
      channel: sender.channel,
      status: "pending",
    });

    // 23505 = a pending approval alert for this business already exists (unique
    // partial index on business_id, kind). That's the batching guarantee doing
    // its job — not an error.
    if (error && error.code !== "23505") {
      logger.error({ error, businessId }, "[Qwickly Notify] failed to enqueue approval alert");
    }
  }
}

// ── phase 2: drain / send (all kinds) ────────────────────────────────────────

async function markSent(id: string, attempts: number, providerMessageId: string | null): Promise<void> {
  await getSupabaseAdmin()
    .from("platform_whatsapp_notifications")
    .update({
      status: "sent",
      attempts,
      provider_message_id: providerMessageId,
      error_message: null,
      next_attempt_at: null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function markSkipped(id: string): Promise<void> {
  await getSupabaseAdmin()
    .from("platform_whatsapp_notifications")
    .update({ status: "skipped", updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function failOrRetry(row: NotificationRow, attempts: number, errorMessage: string): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await getSupabaseAdmin()
      .from("platform_whatsapp_notifications")
      .update({ status: "failed", attempts, error_message: errorMessage, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return;
  }
  const nextAttemptAt = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
  await getSupabaseAdmin()
    .from("platform_whatsapp_notifications")
    .update({ attempts, next_attempt_at: nextAttemptAt, error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

/** Advance approval-alert throttle state after a successful send. */
async function recordApprovalPing(businessId: string, count: number, now: Date): Promise<void> {
  const today = sastDateKey(now);
  const { data: existing } = await getSupabaseAdmin()
    .from("owner_approval_alert_state")
    .select("pings_today, pings_day")
    .eq("business_id", businessId)
    .maybeSingle();

  const sameDay = existing?.pings_day === today;
  const pingsToday = (sameDay ? (existing?.pings_today ?? 0) : 0) + 1;

  await getSupabaseAdmin()
    .from("owner_approval_alert_state")
    .upsert(
      {
        business_id: businessId,
        last_pinged_at: now.toISOString(),
        last_pinged_count: count,
        pings_today: pingsToday,
        pings_day: today,
        updated_at: now.toISOString(),
      },
      { onConflict: "business_id" },
    );
}

/** Pending drafts may have been cleared between enqueue and send. */
async function currentPendingCount(businessId: string): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from("whatsapp_ai_drafts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "pending");
  return count ?? 0;
}

async function drainNotifications(now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("platform_whatsapp_notifications")
    .select("id, business_id, kind, to_phone, message, template_name, template_params, attempts")
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    logger.error({ error }, "[Qwickly Notify] failed to fetch pending notifications");
    return;
  }
  const rows = (data ?? []) as NotificationRow[];
  if (rows.length === 0) return;

  const sender = getOfficialSender();

  for (const row of rows) {
    const isApproval = row.kind === APPROVAL_ALERT;
    let templateParams = row.template_params ?? [];
    let liveCount = 0;

    if (isApproval) {
      // Don't nag about a queue the owner already cleared.
      liveCount = await currentPendingCount(row.business_id);
      if (liveCount === 0) {
        await markSkipped(row.id);
        continue;
      }
      templateParams = [String(liveCount), HUB_URL];
    }

    const attempts = (row.attempts ?? 0) + 1;
    const payload: PlatformNotificationSend = {
      toPhone: row.to_phone,
      renderedText: row.message,
      templateName: row.template_name,
      templateParams,
    };

    try {
      const { providerMessageId } = await sender.sendNotification(payload);
      await markSent(row.id, attempts, providerMessageId);
      if (isApproval) await recordApprovalPing(row.business_id, liveCount, now);
      logger.info({ notificationId: row.id, kind: row.kind, businessId: row.business_id }, "[Qwickly Notify] sent");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await failOrRetry(row, attempts, errorMessage);
      logger.error({ notificationId: row.id, attempts, error: errorMessage }, "[Qwickly Notify] send failed");
    }

    // Light jitter so retries/sends don't go out at a robotic fixed interval.
    await new Promise((resolve) => setTimeout(resolve, getRandomDelay(1, 3)));
  }
}

// ── public API ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;
  try {
    const now = new Date();
    await enqueueDueApprovalAlerts(now);
    await drainNotifications(now);
  } catch (err) {
    logger.error({ err }, "[Qwickly Notify] worker tick failed");
  }
}

/**
 * Start the platform-notification worker. Runs every `interval` ms; default 60s,
 * since batching/cooldown make sub-minute resolution pointless.
 */
export function startPlatformNotificationWorker(interval: number = 60000): NodeJS.Timeout {
  logger.info({ intervalMs: interval }, "[Qwickly Notify] starting platform-notification worker");
  return setInterval(() => {
    void tick();
  }, interval);
}
