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
 * Runs the cancellation sweep once at boot and then on an interval. Period-end
 * precision only needs to be "same hour", so the default is hourly.
 */
export function startSubscriptionLifecycleWorker(intervalMs = 60 * 60 * 1000): void {
  void processScheduledCancellations();
  setInterval(() => {
    void processScheduledCancellations();
  }, intervalMs);
  logger.info({ intervalMs }, "[Subscription Sweep] Lifecycle worker started");
}
