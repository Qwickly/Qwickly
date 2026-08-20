import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { sendEmail, isEmailConfigured } from "../lib/email-sender";
import { logger } from "../lib/logger";

/**
 * "N people booked while you were away."
 *
 * When a trial ends the owner is locked out of the dashboard, but their booking
 * page keeps working for a week (see migration 20260821130000). That week is
 * deliberately not just politeness: every booking taken during it is a real
 * appointment sitting in an account the owner cannot open.
 *
 * Telling them so is the strongest conversion argument we have. A countdown
 * email argues about a subscription; this one says four named customers are
 * expecting them on Tuesday. It is also the only warning they get that real
 * commitments are accumulating out of sight — which is a duty, not just a sales
 * tactic.
 *
 * One email per business per day, at most, however many bookings arrive.
 */

/** Matches the INTERVAL in business_booking_access. */
const GRACE_DAYS = 7;

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

type LapsedSubscription = {
  business_id: string | null;
  user_id: string | null;
  current_period_end: string | null;
};

/** Today's date in SAST, as YYYY-MM-DD — the per-day send key. */
function sastToday(): string {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().split("T")[0]!;
}

function billingUrl(): string {
  const base = (
    process.env["APP_BASE_URL"]?.trim() ||
    process.env["APP_PUBLIC_URL"]?.trim() ||
    "https://qwickly.co.za"
  ).replace(/\/+$/, "");
  return `${base}/billing`;
}

function buildMessage(
  businessName: string,
  bookingCount: number,
  graceDaysLeft: number,
): { subject: string; text: string } {
  const name = businessName.trim() || "your business";
  const people = bookingCount === 1 ? "1 person has" : `${bookingCount} people have`;
  const appointments = bookingCount === 1 ? "appointment" : "appointments";

  const closing =
    graceDaysLeft <= 1
      ? `Your booking page stops accepting bookings tomorrow. After that, customers trying to book ${name} will be turned away.`
      : `Your booking page keeps taking bookings for another ${graceDaysLeft} days. After that it stops accepting them.`;

  return {
    subject:
      bookingCount === 1
        ? "Someone booked while your trial was expired"
        : `${bookingCount} people booked while your trial was expired`,
    text:
      `${people} booked with ${name} since your free trial ended.\n\n` +
      `Those ${appointments} are real — the customers are expecting you. You can't see ` +
      `them because your dashboard is locked, and they don't know that.\n\n` +
      `${closing}\n\n` +
      `Choose a plan and everything is exactly where you left it: ${billingUrl()}`,
  };
}

async function resolveOwnerEmail(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  businessId: string,
  userId: string | null,
): Promise<{ email: string; businessName: string } | null> {
  const { data: business } = await supabase
    .from("businesses")
    .select("email, business_name")
    .eq("id", businessId)
    .maybeSingle();

  const businessName = (business?.business_name as string | null) ?? "";
  const businessEmail = ((business?.email as string | null) ?? "").trim();
  if (businessEmail) return { email: businessEmail, businessName };

  if (userId) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    const authEmail = data?.user?.email?.trim();
    if (!error && authEmail) return { email: authEmail, businessName };
  }

  return null;
}

export async function notifyGraceBookings(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    logger.error("[Grace Bookings] Supabase is not configured");
    return;
  }

  if (!isEmailConfigured()) {
    logger.debug("[Grace Bookings] Email not configured; skipping");
    return;
  }

  const supabase = getSupabaseAdmin();
  const graceStart = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const today = sastToday();

  try {
    // Businesses inside the grace window: their subscription ended within the
    // last GRACE_DAYS. Mirrors business_booking_access rather than trusting it,
    // because that function answers about one business at a time.
    const { data: lapsed, error } = await supabase
      .from("subscriptions")
      .select("business_id, user_id, current_period_end")
      .in("status", ["trial_expired", "canceled"])
      .gt("current_period_end", graceStart.toISOString())
      .lte("current_period_end", new Date().toISOString());

    if (error) {
      logger.error({ err: error }, "[Grace Bookings] Error fetching lapsed subscriptions");
      return;
    }

    if (!lapsed || lapsed.length === 0) return;

    for (const sub of lapsed as LapsedSubscription[]) {
      const businessId = sub.business_id;
      if (!businessId || !sub.current_period_end) continue;

      const lapsedAt = new Date(sub.current_period_end);

      // Bookings CREATED since the lockout — not bookings scheduled since then.
      // A customer booking today for next month is exactly the case worth
      // telling the owner about, and start_time would miss it entirely.
      const { count, error: countError } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gt("created_at", lapsedAt.toISOString());

      if (countError) {
        logger.error(
          { err: countError, businessId },
          "[Grace Bookings] Error counting bookings",
        );
        continue;
      }

      const bookingCount = count ?? 0;
      if (bookingCount === 0) continue;

      // Claim the day before sending — the primary key on
      // (business_id, sent_on) makes a duplicate send impossible even if two
      // ticks overlap.
      const { error: claimError } = await supabase
        .from("grace_booking_alerts")
        .insert({ business_id: businessId, sent_on: today, booking_count: bookingCount });

      if (claimError) continue; // already sent today

      const owner = await resolveOwnerEmail(supabase, businessId, sub.user_id);
      if (!owner) {
        logger.warn({ businessId }, "[Grace Bookings] No address for owner; releasing claim");
        await releaseClaim(supabase, businessId, today);
        continue;
      }

      const graceDaysLeft = Math.max(
        0,
        Math.ceil(
          (lapsedAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000 - Date.now()) /
            (24 * 60 * 60 * 1000),
        ),
      );

      const { subject, text } = buildMessage(owner.businessName, bookingCount, graceDaysLeft);

      try {
        await sendEmail({ to: owner.email, subject, text });
        logger.info(
          { businessId, bookingCount, graceDaysLeft },
          "[Grace Bookings] Alert sent",
        );
      } catch (sendError) {
        logger.error(
          { err: sendError, businessId },
          "[Grace Bookings] Send failed; releasing claim for retry",
        );
        await releaseClaim(supabase, businessId, today);
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[Grace Bookings] Error processing grace alerts");
  }
}

async function releaseClaim(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  businessId: string,
  sentOn: string,
): Promise<void> {
  const { error } = await supabase
    .from("grace_booking_alerts")
    .delete()
    .eq("business_id", businessId)
    .eq("sent_on", sentOn);

  if (error) {
    logger.error(
      { err: error, businessId, sentOn },
      "[Grace Bookings] Failed to release claim; today's alert will not retry",
    );
  }
}

/**
 * Four times a day. Often enough that a booking taken in the morning is reported
 * the same day, rare enough that the one-per-day cap does most of the work.
 */
export function startGraceBookingWorker(intervalMs = DEFAULT_INTERVAL_MS): void {
  void notifyGraceBookings();
  setInterval(() => {
    void notifyGraceBookings();
  }, intervalMs);
  logger.info({ intervalMs }, "[Grace Bookings] Worker started");
}
