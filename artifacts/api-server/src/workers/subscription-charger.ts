import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";

const PAYFAST_API_URL = process.env["PAYFAST_API_URL"] ?? "https://api.payfast.co.za";
const PAYFAST_SANDBOX_API_URL = process.env["PAYFAST_SANDBOX_API_URL"] ?? "https://sandbox.payfast.co.za";
const PAYFAST_MERCHANT_ID = process.env["PAYFAST_MERCHANT_ID"] ?? "34837169";
const PAYFAST_MERCHANT_KEY = process.env["PAYFAST_MERCHANT_KEY"] ?? "lbp3p79l1ljhz";

interface Subscription {
  id: string;
  business_id: string;
  plan_id: string;
  payfast_token: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface Plan {
  id: string;
  price_cents: number;
  billing_interval: string;
  interval_count: number;
}

/**
 * Charge a subscription using PayFast Ad Hoc token
 */
async function chargeSubscription(token: string, amount: number, description: string): Promise<{ success: boolean; error?: string }> {
  const isSandbox = process.env["PAYFAST_MODE"] === "sandbox";
  const apiUrl = isSandbox ? PAYFAST_SANDBOX_API_URL : PAYFAST_API_URL;

  try {
    const response = await fetch(`${apiUrl}/subscriptions/${token}/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_id: PAYFAST_MERCHANT_ID,
        merchant_key: PAYFAST_MERCHANT_KEY,
        amount: (amount / 100).toFixed(2), // Convert cents to Rands
        item_name: description,
      }),
    });

    const data = await response.json() as { status?: string; code?: number; message?: string };

    if (data.status === "success" || data.code === 200) {
      return { success: true };
    } else {
      return { success: false, error: data.message || "Payment failed" };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Process due subscriptions - called by CRON job
 */
export async function processDueSubscriptions(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    console.error("[Subscription Charger] Supabase is not configured");
    return;
  }

  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString();

  console.log("[Subscription Charger] Starting to process due subscriptions...");

  try {
    // Get all active subscriptions that are due for renewal
    const { data: dueSubscriptions, error: fetchError } = await supabase
      .from("subscriptions")
      .select(`
        *,
        plans!inner (
          id,
          price_cents,
          billing_interval,
          interval_count
        )
      `)
      .eq("status", "active")
      .eq("cancel_at_period_end", false)
      .lte("current_period_end", today)
      .is("payfast_token", "not null");

    if (fetchError) {
      console.error("[Subscription Charger] Error fetching due subscriptions:", fetchError);
      return;
    }

    if (!dueSubscriptions || dueSubscriptions.length === 0) {
      console.log("[Subscription Charger] No due subscriptions found");
      return;
    }

    console.log(`[Subscription Charger] Found ${dueSubscriptions.length} due subscriptions`);

    for (const subscription of dueSubscriptions) {
      const plan = subscription.plans as Plan;
      const token = subscription.payfast_token;

      if (!token) {
        console.error(`[Subscription Charger] Subscription ${subscription.id} has no token`);
        continue;
      }

      console.log(`[Subscription Charger] Processing subscription ${subscription.id} for plan ${plan.id}`);

      // Charge the subscription
      const chargeResult = await chargeSubscription(
        token,
        plan.price_cents,
        `Bookza ${plan.id} subscription renewal`
      );

      if (chargeResult.success) {
        // Calculate new period end
        const currentPeriodEnd = new Date(subscription.current_period_end);
        const newPeriodEnd = new Date(currentPeriodEnd);

        if (plan.billing_interval === "month") {
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + plan.interval_count);
        } else if (plan.billing_interval === "year") {
          newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + plan.interval_count);
        }

        // Update subscription with new period end
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            current_period_end: newPeriodEnd.toISOString(),
            metadata: {
              ...subscription.metadata,
              last_charge_date: new Date().toISOString(),
              last_charge_amount: plan.price_cents,
            },
          })
          .eq("id", subscription.id);

        if (updateError) {
          console.error(`[Subscription Charger] Error updating subscription ${subscription.id}:`, updateError);
        } else {
          console.log(`[Subscription Charger] Successfully renewed subscription ${subscription.id}`);
        }
      } else {
        // Mark subscription as past_due
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "past_due",
            metadata: {
              ...subscription.metadata,
              last_charge_error: chargeResult.error,
              last_charge_attempt: new Date().toISOString(),
            },
          })
          .eq("id", subscription.id);

        if (updateError) {
          console.error(`[Subscription Charger] Error marking subscription ${subscription.id} as past_due:`, updateError);
        } else {
          console.log(`[Subscription Charger] Marked subscription ${subscription.id} as past_due: ${chargeResult.error}`);
        }
     }
    }

    console.log("[Subscription Charger] Finished processing due subscriptions");
  } catch (error) {
    console.error("[Subscription Charger] Error processing subscriptions:", error);
  }
}

/**
 * Handle pending downgrades - switch plans when period ends
 */
export async function processPendingDowngrades(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    console.error("[Subscription Charger] Supabase is not configured");
    return;
  }

  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString();

  console.log("[Subscription Charger] Processing pending downgrades...");

  try {
    // Get subscriptions with pending plan changes
    const { data: pendingSubscriptions, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*")
      .not("pending_plan_id", "is", null)
      .lte("current_period_end", today);

    if (fetchError) {
      console.error("[Subscription Charger] Error fetching pending downgrades:", fetchError);
      return;
    }

    if (!pendingSubscriptions || pendingSubscriptions.length === 0) {
      console.log("[Subscription Charger] No pending downgrades found");
      return;
    }

    console.log(`[Subscription Charger] Found ${pendingSubscriptions.length} pending downgrades`);

    for (const subscription of pendingSubscriptions) {
      const newPlanId = subscription.pending_plan_id;
      const oldPlanId = subscription.plan_id;

      console.log(`[Subscription Charger] Downgrading subscription ${subscription.id} from ${oldPlanId} to ${newPlanId}`);

      // Get new plan details
      const { data: newPlan, error: planError } = await supabase
        .from("plans")
        .select("*")
        .eq("id", newPlanId)
        .single();

      if (planError || !newPlan) {
        console.error(`[Subscription Charger] Error fetching new plan ${newPlanId}:`, planError);
        continue;
      }

      // Calculate new period end
      const currentPeriodEnd = new Date(subscription.current_period_end);
      const newPeriodEnd = new Date(currentPeriodEnd);

      if (newPlan.billing_interval === "month") {
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + newPlan.interval_count);
      } else if (newPlan.billing_interval === "year") {
        newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + newPlan.interval_count);
      }

      // Update subscription with new plan
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan_id: newPlanId,
          current_period_end: newPeriodEnd.toISOString(),
          pending_plan_id: null,
          cancel_at_period_end: false,
          metadata: {
            ...subscription.metadata,
            downgraded_from: oldPlanId,
            downgraded_at: new Date().toISOString(),
          },
        })
        .eq("id", subscription.id);

      if (updateError) {
        console.error(`[Subscription Charger] Error updating subscription ${subscription.id}:`, updateError);
      } else {
        console.log(`[Subscription Charger] Successfully downgraded subscription ${subscription.id}`);
      }
    }

    console.log("[Subscription Charger] Finished processing pending downgrades");
  } catch (error) {
    console.error("[Subscription Charger] Error processing downgrades:", error);
  }
}

/**
 * Handle scheduled cancellations
 */
export async function processScheduledCancellations(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    console.error("[Subscription Charger] Supabase is not configured");
    return;
  }

  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString();

  console.log("[Subscription Charger] Processing scheduled cancellations...");

  try {
    // Get subscriptions marked for cancellation at period end
    const { data: cancellations, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("cancel_at_period_end", true)
      .lte("current_period_end", today)
      .in("status", ["active", "trialing"]);

    if (fetchError) {
      console.error("[Subscription Charger] Error fetching scheduled cancellations:", fetchError);
      return;
    }

    if (!cancellations || cancellations.length === 0) {
      console.log("[Subscription Charger] No scheduled cancellations found");
      return;
    }

    console.log(`[Subscription Charger] Found ${cancellations.length} scheduled cancellations`);

    for (const subscription of cancellations) {
      console.log(`[Subscription Charger] Cancelling subscription ${subscription.id}`);

      // Cancel the subscription
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
        console.error(`[Subscription Charger] Error cancelling subscription ${subscription.id}:`, updateError);
      } else {
        console.log(`[Subscription Charger] Successfully cancelled subscription ${subscription.id}`);
      }
    }

    console.log("[Subscription Charger] Finished processing scheduled cancellations");
  } catch (error) {
    console.error("[Subscription Charger] Error processing cancellations:", error);
  }
}

/**
 * Main function to run all subscription processing tasks
 */
export async function runSubscriptionProcessing(): Promise<void> {
  console.log("[Subscription Charger] Starting subscription processing...");

  await processScheduledCancellations();
  await processDueSubscriptions();
  await processPendingDowngrades();

  console.log("[Subscription Charger] Subscription processing complete");
}
