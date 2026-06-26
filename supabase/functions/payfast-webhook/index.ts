import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { md5 } from "https://esm.sh/js-md5@0.8.3"

const PAYFAST_SANDBOX_MERCHANT_ID = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE = Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "";
const PAYFAST_PRODUCTION_MERCHANT_KEY = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "";
const PAYFAST_PRODUCTION_PASSPHRASE = Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "";

function encodePayFastValue(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

function createPayFastSignature(fields: Record<string, string>, passphrase: string): string {
  const parameterString = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return md5(parameterString);
}

serve(async (req) => {
  console.log("[PayFast Webhook] Request received", JSON.stringify(await req.json()));

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const receivedSignature = body.signature;
    const fields: Record<string, string> = {};
    
    Object.entries(body).forEach(([key, value]) => {
      if (key !== "signature" && typeof value === "string") {
        fields[key] = value;
      }
    });

    console.log("[PayFast Webhook] Extracted fields", JSON.stringify(fields));

    const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
    const passphrase = isSandbox ? PAYFAST_SANDBOX_PASSPHRASE : PAYFAST_PRODUCTION_PASSPHRASE;
    const expectedSignature = createPayFastSignature(fields, passphrase);
    
    console.log("[PayFast Webhook] Signature validation", { received: receivedSignature, expected: expectedSignature });

    if (!receivedSignature || receivedSignature !== expectedSignature) {
      console.error("[PayFast Webhook] Invalid signature");
      return new Response("Invalid signature", { status: 400 });
    }

    const paymentReference = fields.m_payment_id;
    const businessId = fields.custom_str2;
    const planId = fields.custom_str3;
    const payfastStatus = fields.payment_status?.toUpperCase();
    const token = fields.token;

    console.log("[PayFast Webhook] Payment details", { paymentReference, businessId, planId, payfastStatus, token });

    if (!paymentReference || !businessId || !planId) {
      console.error("[PayFast Webhook] Missing required fields");
      return new Response("Missing required fields", { status: 400 });
    }

    if (payfastStatus === "COMPLETE") {
      // Get the incomplete subscription
      const { data: subscription, error: fetchError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .maybeSingle();

        console.log("[PayFast Webhook] Subscription lookup", { subscription, error: fetchError });

      if (fetchError) throw new Error(fetchError.message);

      if (subscription) {
        // This is the initial payment - activate subscription with token
        console.log("[PayFast Webhook] Activating subscription", { subscriptionId: subscription.id, token });
        
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "active",
            payfast_token: token || null,
            metadata: {
              ...subscription.metadata,
              payfast_token: token || null,
              initial_payment_reference: paymentReference,
              payment_method: isSandbox ? "payfast_sandbox" : "payfast_production",
              verified_at: new Date().toISOString(),
            },
          })
          .eq("id", subscription.id);

        if (updateError) {
          console.error("[PayFast Webhook] Failed to activate subscription", updateError);
          throw new Error(updateError.message);
        }
        
        console.log("[PayFast Webhook] Subscription activated successfully");
      } else {
        // This might be a recurring payment
        console.log("[PayFast Webhook] No incomplete subscription found, checking for active subscription");
        
        const { data: activeSubscription } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", businessId)
          .eq("plan_id", planId)
          .eq("status", "active")
          .maybeSingle();

        if (activeSubscription) {
          // Update period end for recurring payment
          const currentPeriodEnd = new Date(activeSubscription.current_period_end);
          const newPeriodEnd = new Date(currentPeriodEnd);
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

          const { error: updateError } = await supabase
            .from("subscriptions")
            .update({
              current_period_end: newPeriodEnd.toISOString(),
              metadata: {
                ...activeSubscription.metadata,
                last_payment_reference: paymentReference,
                last_payment_at: new Date().toISOString(),
              },
            })
            .eq("id", activeSubscription.id);

          if (updateError) {
            console.error("[PayFast Webhook] Failed to update period end", updateError);
            throw new Error(updateError.message);
          }
          
          console.log("[PayFast Webhook] Period end updated for recurring payment");
        } else {
          console.error("[PayFast Webhook] No subscription found for business", { businessId, planId });
        }
      }
    } else if (payfastStatus === "CANCELLED" || payfastStatus === "FAILED") {
      console.log("[PayFast Webhook] Payment cancelled/failed", { payfastStatus });
      
      // Handle failed/cancelled initial payment
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .maybeSingle();

      if (subscription) {
        // Delete incomplete subscription
        const { error: deleteError } = await supabase
          .from("subscriptions")
          .delete()
          .eq("id", subscription.id);

        if (deleteError) {
          console.error("[PayFast Webhook] Failed to delete incomplete subscription", deleteError);
          throw new Error(deleteError.message);
        }
        
        console.log("[PayFast Webhook] Incomplete subscription deleted");
      }
    } else {
      console.log("[PayFast Webhook] Unhandled payment status", { payfastStatus });
    }

    console.log("[PayFast Webhook] Processing complete");
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[PayFast Webhook] Error processing notification", err);
    return new Response("Could not process PayFast notification", { status: 500 });
  }
});