import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { md5 } from "https://esm.sh/js-md5@0.8.3"

const PLAN_PRICES: Record<string, number> = {
  Starter: 400,
  Growth: 1500,
  Business: 5000,
};

const PAYFAST_SANDBOX_URL = Deno.env.get("PAYFAST_SANDBOX_URL") || "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_PRODUCTION_URL = Deno.env.get("PAYFAST_PRODUCTION_URL") || "https://www.payfast.co.za/eng/process";
const PAYFAST_SANDBOX_MERCHANT_ID = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE = Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "";
const PAYFAST_PRODUCTION_MERCHANT_KEY = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "";
const PAYFAST_PRODUCTION_PASSPHRASE = Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "";

function encodePayFastValue(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

async function createPayFastSignature(fields: Record<string, string>, passphrase: string): Promise<string> {
  const parameterString = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return md5(parameterString);
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  console.log(`[Subscription Management] ${method} ${path}`);

  try {
    // Handle CORS
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Verify user from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response("Invalid token", { status: 401 });
    }

    // Get business for user
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (businessError || !business) {
      return new Response("Business not found", { status: 404 });
    }

    // GET /subscription-management - Fetch current subscription
    if (method === "GET" && path === "/subscription-management") {
      const { data: subscription, error } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return new Response(JSON.stringify(subscription), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // POST /subscription-management/payfast - Create PayFast subscription
    if (method === "POST" && path === "/subscription-management/payfast") {
      const body = await req.json();
      const { planName, origin } = body;

      if (!planName || !PLAN_PRICES[planName]) {
        return new Response("Invalid plan name", { status: 400 });
      }

      const price = PLAN_PRICES[planName];
      const subscriptionId = `bookza-sub-${Date.now()}`;
      const planId = `${planName.toLowerCase()}_monthly`;

      // Get plan details
      const { data: plan, error: planError } = await supabase
        .from("plans")
        .select("*")
        .eq("id", planId)
        .single();

      if (planError || !plan) {
        return new Response("Plan not found", { status: 400 });
      }

      // Create incomplete subscription
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const { error: subscriptionError } = await supabase
        .from("subscriptions")
        .insert({
          user_id: user.id,
          business_id: business.id,
          plan_id: planId,
          status: "incomplete",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
        });

      if (subscriptionError) {
        if (subscriptionError.message.includes("violates unique constraint")) {
          return new Response("You already have an active subscription", { status: 400 });
        }
        throw new Error(subscriptionError.message);
      }

      const fields: Record<string, string> = {
        merchant_id: PAYFAST_SANDBOX_MERCHANT_ID,
        merchant_key: PAYFAST_SANDBOX_MERCHANT_KEY,
        return_url: `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
        cancel_url: `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
        notify_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
        name_first: "Bookza",
        name_last: "Subscription",
        email_address: "subscriptions@bookza.co.za",
        m_payment_id: subscriptionId,
        amount: price.toString(),
        item_name: `Bookza ${planName} Subscription`,
        item_description: `Monthly subscription for ${planName} plan`,
        custom_str1: "bookza_subscription",
        custom_str2: business.id,
        custom_str3: planId,
        subscription_type: "1",
        frequency: "3",
        cycles: "0",
      };

      const signature = await createPayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);

      return new Response(JSON.stringify({
        action: PAYFAST_SANDBOX_URL,
        subscriptionId,
        fields: {
          ...fields,
          signature,
        },
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // POST /subscription-management/payfast/check-status - Check payment status
    if (method === "POST" && path === "/subscription-management/payfast/check-status") {
      const body = await req.json();
      const { paymentReference } = body;

      if (!paymentReference) {
        return new Response("Missing payment reference", { status: 400 });
      }

      // Check if business already has an active subscription
      const { data: activeSubscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "active")
        .maybeSingle();

      if (activeSubscription) {
        // Delete incomplete subscriptions
        await supabase
          .from("subscriptions")
          .delete()
          .eq("business_id", business.id)
          .eq("status", "incomplete");

        // Return active subscription with plans
        const { data: activeWithPlans } = await supabase
          .from("subscriptions")
          .select("*, plans(*)")
          .eq("id", activeSubscription.id)
          .single();

        return new Response(JSON.stringify(activeWithPlans), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Get incomplete subscription
      const { data: subscriptions } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "incomplete")
        .order("created_at", { ascending: false })
        .limit(1);

      const subscription = subscriptions && subscriptions.length > 0 ? subscriptions[0] : null;

      if (!subscription) {
        return new Response("No incomplete subscription found", { status: 404 });
      }

      // Activate subscription
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          payfast_token: null,
          metadata: {
            ...subscription.metadata,
            initial_payment_reference: paymentReference,
            payment_method: "payfast_sandbox",
            verified_at: new Date().toISOString(),
          },
        })
        .eq("id", subscription.id);

      if (updateError) throw new Error(updateError.message);

      // Return updated subscription
      const { data: updatedSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", subscription.id)
        .single();

      return new Response(JSON.stringify(updatedSubscription), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // PUT /subscription-management - Update subscription
    if (method === "PUT" && path === "/subscription-management") {
      const body = await req.json();
      const { planName, immediate } = body;

      if (!planName || !PLAN_PRICES[planName]) {
        return new Response("Invalid plan name", { status: 400 });
      }

      const newPlanId = `${planName.toLowerCase()}_monthly`;

      // Get current subscription
      const { data: currentSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("business_id", business.id)
        .eq("status", "active")
        .maybeSingle();

      if (!currentSubscription) {
        return new Response("No active subscription found", { status: 400 });
      }

      const currentPlan = currentSubscription.plans as { id: string; price_cents: number };
      const { data: newPlan } = await supabase
        .from("plans")
        .select("*")
        .eq("id", newPlanId)
        .single();

      if (!newPlan) {
        return new Response("New plan not found", { status: 400 });
      }

      const isUpgrade = newPlan.price_cents > currentPlan.price_cents;
      const isDowngrade = newPlan.price_cents < currentPlan.price_cents;

      if (isDowngrade) {
        // Schedule downgrade
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            pending_plan_id: newPlanId,
            metadata: {
              ...currentSubscription.metadata,
              pending_downgrade_to: newPlanId,
              pending_downgrade_at: currentSubscription.current_period_end,
            },
          })
          .eq("id", currentSubscription.id);

        if (updateError) throw new Error(updateError.message);

        const { data: updatedSubscription } = await supabase
          .from("subscriptions")
          .select("*, plans(*)")
          .eq("id", currentSubscription.id)
          .single();

        return new Response(JSON.stringify({
          ...updatedSubscription,
          message: "Downgrade scheduled for end of billing period",
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Update immediately for upgrades or same price
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          plan_id: newPlanId,
          metadata: {
            ...currentSubscription.metadata,
            changed_from: currentPlan.id,
            changed_at: new Date().toISOString(),
          },
        })
        .eq("id", currentSubscription.id);

      if (updateError) throw new Error(updateError.message);

      const { data: updatedSubscription } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("id", currentSubscription.id)
        .single();

      return new Response(JSON.stringify(updatedSubscription), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // DELETE /subscription-management - Cancel subscription
    if (method === "DELETE" && path === "/subscription-management") {
      const { data: currentSubscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "active")
        .maybeSingle();

      if (!currentSubscription) {
        return new Response("No active subscription found", { status: 400 });
      }

      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          status: "canceled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", currentSubscription.id);

      if (updateError) throw new Error(updateError.message);

      return new Response(JSON.stringify(currentSubscription), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("[Subscription Management] Error:", err);
    return new Response(err.message || "Internal server error", { status: 500 });
  }
});