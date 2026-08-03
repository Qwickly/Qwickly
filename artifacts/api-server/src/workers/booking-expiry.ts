import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { recordActivity } from "../lib/activity";
import { logger } from "../lib/logger";

/**
 * Releases the slot held by a deposit-required booking that never got paid.
 * Bookings created via create_public_booking (069_booking_pending_expiry.sql)
 * or the WhatsApp AI flow get pending_expires_at set only when a deposit is
 * required; everything else has it NULL and is never touched here.
 *
 * A single conditional UPDATE ... WHERE is already race-safe/idempotent — no
 * claim/lease needed (unlike notification-worker.ts's queues, which process
 * many rows per business over multiple ticks). Re-checking status/deposit_paid
 * in the UPDATE's WHERE (not just the SELECT) avoids double-cancelling a
 * booking a webhook just marked paid between the fetch and the update.
 *
 * Cancelling here relies on the existing manage_booking_client_notifications
 * trigger (049_client_notifications_per_channel.sql) — it fires on any UPDATE
 * of bookings.status and already inserts a cancellation_notices row itself.
 * Do NOT also insert one manually here; that would double-notify the client.
 */

const MAX_PER_RUN = 200;

export async function processBookingExpiry(options: { dryRun?: boolean } = {}): Promise<void> {
  const { dryRun = false } = options;

  if (!isSupabaseAdminConfigured()) {
    logger.error("[Booking Expiry] Supabase is not configured");
    return;
  }

  const supa = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  try {
    const { data: expired, error } = await supa
      .from("bookings")
      .select("id, business_id")
      .eq("status", "pending")
      .eq("deposit_paid", false)
      .lt("pending_expires_at", nowIso)
      .limit(MAX_PER_RUN);

    if (error) {
      logger.error({ err: error }, "[Booking Expiry] Failed to fetch expired bookings");
      return;
    }

    if (!expired || expired.length === 0) return;

    if (dryRun) {
      logger.warn(
        { count: expired.length, bookingIds: expired.map((b) => b.id) },
        "[Booking Expiry] DRY RUN — would cancel these unpaid-deposit bookings",
      );
      return;
    }

    for (const booking of expired) {
      const { data: cancelled, error: updateError } = await supa
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id)
        .eq("status", "pending")
        .eq("deposit_paid", false)
        .select("id")
        .maybeSingle();

      if (updateError) {
        logger.error({ err: updateError, bookingId: booking.id }, "[Booking Expiry] Failed to cancel booking");
        continue;
      }
      if (!cancelled) continue; // a webhook raced this row to paid — leave it alone

      const { error: paymentError } = await supa
        .from("payments")
        .update({ status: "failed" })
        .eq("booking_id", booking.id)
        .eq("type", "deposit")
        .eq("status", "pending");

      if (paymentError) {
        logger.error({ err: paymentError, bookingId: booking.id }, "[Booking Expiry] Failed to mark payment failed");
      }

      await recordActivity({
        businessId: booking.business_id,
        actorType: "system",
        entityType: "booking",
        entityId: booking.id,
        eventType: "booking_auto_cancelled",
        title: "Booking auto-cancelled",
        description: "Deposit was not paid within 30 minutes — the slot was released.",
      });

      logger.info({ bookingId: booking.id }, "[Booking Expiry] Cancelled unpaid-deposit booking");
    }
  } catch (err) {
    logger.error({ err }, "[Booking Expiry] Tick failed");
  }
}

export function startBookingExpiryWorker(
  intervalMs = 60_000,
  options: { dryRun?: boolean } = {},
): NodeJS.Timeout {
  logger.info({ intervalMs, dryRun: options.dryRun ?? false }, "[Booking Expiry] starting");
  return setInterval(() => {
    void processBookingExpiry(options);
  }, intervalMs);
}
