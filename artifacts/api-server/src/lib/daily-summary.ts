import { getSupabaseAdmin } from "./supabase";
import { logger } from "./logger";

/**
 * Staff daily-schedule summary (the "Daily Schedule Summary" toggle).
 *
 * Once per day, after 07:00 SAST, this builds each active staff member's
 * appointments for the day and enqueues a 'daily_summary' row into
 * staff_notifications. The existing notification worker (notification-worker.ts)
 * then delivers it over WhatsApp — so we reuse its retry/backoff, auto-pause and
 * jitter instead of sending here.
 *
 * SAST is a fixed UTC+2 (no daylight saving), so the timezone maths is just an
 * offset rather than a timezone library.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
// Don't generate before this hour (SAST). The marker table makes it idempotent,
// so any tick after this hour generates the day's summaries exactly once.
const SEND_FROM_HOUR_SAST = 7;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // re-check every 15 minutes

const ACTIVE_STATUSES = new Set(["confirmed", "pending", "completed"]);

let isRunning = false;

type SummaryBookingRow = {
  start_time: string;
  status: string;
  clients: { name: string } | { name: string }[] | null;
  services: { name: string } | { name: string }[] | null;
};

/** Supabase returns a to-one relation as an object or a single-element array. */
function relationName(rel: { name: string } | { name: string }[] | null): string {
  if (!rel) return "";
  return Array.isArray(rel) ? (rel[0]?.name ?? "") : rel.name;
}

function sastNow(): Date {
  return new Date(Date.now() + SAST_OFFSET_MS);
}

/** Current SAST calendar date as YYYY-MM-DD. */
function sastDateString(): string {
  return sastNow().toISOString().slice(0, 10);
}

function sastTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildMessage(staffName: string, sastDate: string, bookings: SummaryBookingRow[]): string {
  const prettyDate = new Date(`${sastDate}T00:00:00+02:00`).toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const firstName = staffName.split(" ")[0] || staffName;

  if (bookings.length === 0) {
    return `Good morning ${firstName}! You have no appointments scheduled for ${prettyDate}. Enjoy your day!`;
  }

  const lines = bookings.map((b, i) => {
    const time = sastTimeOfDay(b.start_time);
    const service = relationName(b.services) || "Appointment";
    const client = relationName(b.clients) || "Client";
    return `${i + 1}. ${time} — ${service} with ${client}`;
  });

  const count = bookings.length;
  const header = `Good morning ${firstName}! Here's your schedule for ${prettyDate} (${count} appointment${count === 1 ? "" : "s"}):`;
  return `${header}\n\n${lines.join("\n")}\n\nHave a great day!`;
}

/** Enqueue a daily summary for one staff member, claiming the marker first. */
async function enqueueForStaff(
  businessId: string,
  staff: { id: string; name: string },
  sastDate: string,
  dayStartIso: string,
  dayEndIso: string,
): Promise<"enqueued" | "skipped"> {
  // Claim the once-per-day marker. If it already exists, another run/instance
  // (or an earlier tick today) already handled this staff member.
  const { error: markerError } = await getSupabaseAdmin()
    .from("staff_daily_summary_log")
    .insert({ business_id: businessId, staff_id: staff.id, summary_date: sastDate });

  if (markerError) {
    if (markerError.code === "23505") return "skipped"; // already generated today
    logger.error({ error: markerError, staffId: staff.id }, "[Daily Summary] Failed to claim marker");
    return "skipped";
  }

  const { data: bookingData, error: bookingError } = await getSupabaseAdmin()
    .from("bookings")
    .select("start_time, status, clients(name), services(name)")
    .eq("business_id", businessId)
    .eq("staff_id", staff.id)
    .gte("start_time", dayStartIso)
    .lt("start_time", dayEndIso)
    .order("start_time", { ascending: true });

  if (bookingError) {
    logger.error({ error: bookingError, staffId: staff.id }, "[Daily Summary] Failed to load bookings");
    return "skipped";
  }

  const bookings = ((bookingData ?? []) as unknown as SummaryBookingRow[]).filter((b) =>
    ACTIVE_STATUSES.has(b.status),
  );

  const message = buildMessage(staff.name, sastDate, bookings);

  const { error: insertError } = await getSupabaseAdmin()
    .from("staff_notifications")
    .insert({
      business_id: businessId,
      staff_id: staff.id,
      booking_id: null,
      notification_type: "daily_summary",
      message,
      scheduled_at: new Date().toISOString(),
      status: "pending",
    });

  if (insertError) {
    logger.error({ error: insertError, staffId: staff.id }, "[Daily Summary] Failed to enqueue notification");
    return "skipped";
  }

  return "enqueued";
}

/**
 * Generate today's staff daily summaries for every business that has the toggle
 * enabled. Safe to call repeatedly — the marker table makes it idempotent.
 */
export async function runStaffDailySummaries(): Promise<void> {
  if (isRunning) return;
  if (sastNow().getUTCHours() < SEND_FROM_HOUR_SAST) return; // too early in the SAST day

  isRunning = true;
  try {
    const { data: settingsRows, error: settingsError } = await getSupabaseAdmin()
      .from("notification_settings")
      .select("business_id")
      .eq("staff_daily_summary", true);

    if (settingsError) {
      logger.error({ error: settingsError }, "[Daily Summary] Failed to load settings");
      return;
    }
    if (!settingsRows || settingsRows.length === 0) return;

    const sastDate = sastDateString();
    const dayStartIso = new Date(`${sastDate}T00:00:00+02:00`).toISOString();
    const dayEndIso = new Date(new Date(`${sastDate}T00:00:00+02:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

    let enqueued = 0;
    for (const row of settingsRows) {
      const businessId = row.business_id as string;

      const { data: staff, error: staffError } = await getSupabaseAdmin()
        .from("staff_members")
        .select("id, name, phone")
        .eq("business_id", businessId)
        .eq("is_active", true);

      if (staffError) {
        logger.error({ error: staffError, businessId }, "[Daily Summary] Failed to load staff");
        continue;
      }

      for (const member of staff ?? []) {
        const phone = (member.phone as string | null) ?? "";
        if (!phone.trim()) continue; // can't message a staff member with no phone

        const result = await enqueueForStaff(
          businessId,
          { id: member.id as string, name: member.name as string },
          sastDate,
          dayStartIso,
          dayEndIso,
        );
        if (result === "enqueued") enqueued++;
      }
    }

    if (enqueued > 0) {
      logger.info({ count: enqueued, sastDate }, "[Daily Summary] Enqueued staff daily summaries");
    }
  } catch (err) {
    logger.error({ err }, "[Daily Summary] Error generating summaries");
  } finally {
    isRunning = false;
  }
}

/**
 * Start the daily-summary scheduler. Runs once on boot (to catch up if the
 * server started after 07:00) and then re-checks on an interval.
 */
export function startDailySummaryScheduler(interval: number = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  logger.info({ intervalMs: interval, sendFromHourSast: SEND_FROM_HOUR_SAST }, "[Daily Summary] Starting scheduler");

  void runStaffDailySummaries();
  return setInterval(() => {
    void runStaffDailySummaries();
  }, interval);
}
