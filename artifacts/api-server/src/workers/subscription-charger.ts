import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { invalidateEntitlements } from "../lib/entitlements";
import { logger } from "../lib/logger";

/**
 * Subscription lifecycle sweep.
 *
 * There is deliberately NO charging logic here. Subscriptions are PayFast
 * "standard subscriptions" (subscription_type=1): PayFast bills the card every
 * cycle itself and notifies us through the payfast-webhook edge function, which
 * extends current_period_end. Re-charging from our side via the Ad Hoc API would
 * double-bill every customer — an earlier version of this file did exactly that
 * (never scheduled, fortunately) and was removed.
 *
 * What DOES need a local sweep is the end-of-life path the webhook never sees:
 * a cancellation. DELETE /subscription-management cancels the PayFast
 * subscription immediately (no further charges) but keeps the row
 * status='active' with cancel_at_period_end=true so the customer retains what
 * they paid for until the period ends. Nothing on PayFast's side fires at that
 * moment — so without this sweep the row stays 'active' forever and
 * entitlements never expire.
 *
 * The second sweep is the card-free trial. Trials used to end themselves:
 * PayFast charged the captured card on day 14 and the webhook flipped the row to
 * 'active'. With no card there is no charge, no ITN, and nothing that ever moves
 * a finished trial out of 'trialing'. See expireFinishedTrials.
 */
export async function processScheduledCancellations(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    logger.error("[Subscription Sweep] Supabase is not configured");
    return;
  }

  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString();

  try {
    // Get subscriptions marked for cancellation whose paid period has ended
    const { data: cancellations, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("cancel_at_period_end", true)
      .lte("current_period_end", today)
      .in("status", ["active", "trialing"]);

    if (fetchError) {
      logger.error(
        { err: fetchError },
        "[Subscription Sweep] Error fetching scheduled cancellations",
      );
      return;
    }

    if (!cancellations || cancellations.length === 0) return;

    logger.info(
      { count: cancellations.length },
      "[Subscription Sweep] Processing scheduled cancellations",
    );

    for (const subscription of cancellations) {
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          payfast_token: null, // Remove token to prevent future charges
          metadata: {
            ...subscription.metadata,
            cancelled_at: new Date().toISOString(),
            cancellation_reason: "Scheduled at period end",
          },
        })
        .eq("id", subscription.id);

      if (updateError) {
        logger.error(
          { err: updateError, subscriptionId: subscription.id },
          "[Subscription Sweep] Error cancelling subscription",
        );
      } else {
        // Access ends now, not when the 60s entitlement cache next expires.
        if (subscription.business_id) {
          invalidateEntitlements(subscription.business_id as string);
        }
        logger.info(
          { subscriptionId: subscription.id },
          "[Subscription Sweep] Subscription cancelled at period end",
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[Subscription Sweep] Error processing cancellations");
  }
}

/**
 * Move finished free trials to 'trial_expired'.
 *
 * This is bookkeeping, NOT the enforcement point. Access is already denied the
 * instant the clock passes current_period_end, by isTrialExpired() in
 * entitlements.ts — deliberately, because gating the product on "a background
 * worker managed to run" is how a restarted container hands out free months.
 *
 * What this earns is a stored status that matches reality: every
 * .in("status", ["active", "trialing"]) query in the codebase (billing reads,
 * add-on attach, the checkout guard) then stops seeing dead trials without each
 * one having to learn the date rule for itself.
 */
export async function expireFinishedTrials(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    logger.error("[Trial Sweep] Supabase is not configured");
    return;
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  try {
    const { data: expired, error: fetchError } = await supabase
      .from("subscriptions")
      .select("id, business_id, metadata")
      .eq("status", "trialing")
      .lte("current_period_end", now);

    if (fetchError) {
      logger.error({ err: fetchError }, "[Trial Sweep] Error fetching finished trials");
      return;
    }

    if (!expired || expired.length === 0) return;

    logger.info({ count: expired.length }, "[Trial Sweep] Expiring finished trials");

    for (const subscription of expired) {
      // Re-assert status='trialing' in the WHERE clause. A customer can subscribe
      // in the gap between the SELECT above and this UPDATE, and overwriting a
      // freshly-paid 'active' row with 'trial_expired' would lock out someone who
      // has just handed us money.
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "trial_expired",
          metadata: {
            ...((subscription.metadata as Record<string, unknown> | null) ?? {}),
            trial_expired_at: new Date().toISOString(),
          },
        })
        .eq("id", subscription.id)
        .eq("status", "trialing");

      if (updateError) {
        logger.error(
          { err: updateError, subscriptionId: subscription.id },
          "[Trial Sweep] Error expiring trial",
        );
        continue;
      }

      if (subscription.business_id) {
        invalidateEntitlements(subscription.business_id as string);
      }
      logger.info({ subscriptionId: subscription.id }, "[Trial Sweep] Trial expired");
    }
  } catch (error) {
    logger.error({ err: error }, "[Trial Sweep] Error expiring trials");
  }
}

/**
 * Runs both lifecycle sweeps once at boot and then on an interval. Period-end
 * precision only needs to be "same hour", so the default is hourly.
 */
export function startSubscriptionLifecycleWorker(intervalMs = 60 * 60 * 1000): void {
  const tick = () => {
    void processScheduledCancellations();
    void expireFinishedTrials();
  };

  tick();
  setInterval(tick, intervalMs);
  logger.info({ intervalMs }, "[Subscription Sweep] Lifecycle worker started");
}
