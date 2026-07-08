import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { md5 } from "https://esm.sh/js-md5@0.8.3"

const PAYFAST_SANDBOX_MERCHANT_ID = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE = Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "34837169";
const PAYFAST_PRODUCTION_MERCHANT_KEY = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "lbp3p79l1ljhz";
const PAYFAST_PRODUCTION_PASSPHRASE = Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "Qwickly2026DT";

function encodePayFastValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function createPayFastSignature(fields: Record<string, string>, passphrase: string): string {
  // PayFast ITN signature: preserve original field order, include empty values
  const parameterString = [
    ...Object.entries(fields).map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  console.log("[PayFast Webhook] Signature calculation string:", parameterString);
  return md5(parameterString);
}

serve(async (req) => {
  console.log("[PayFast Webhook] Request received");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // PayFast sends data as application/x-www-form-urlencoded
    const formData = await req.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    console.log("[PayFast Webhook] Received form data", JSON.stringify(body));

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
    // Don't include passphrase in signature if empty
    const passphraseForSig = passphrase || "";
    const expectedSignature = createPayFastSignature(fields, passphraseForSig);
    
    console.log("[PayFast Webhook] Signature validation", { received: receivedSignature, expected: expectedSignature });

    if (!receivedSignature || receivedSignature !== expectedSignature) {
      console.error("[PayFast Webhook] Invalid signature");
      return new Response("Invalid signature", { status: 400 });
    }

    // PayFast ITN validation: POST back to PayFast to verify the notification
    const validationUrl = isSandbox 
      ? "https://sandbox.payfast.co.za/eng/query/validate"
      : "https://www.payfast.co.za/eng/query/validate";

    console.log("[PayFast Webhook] Validating with PayFast at:", validationUrl);

    try {
      const validationResponse = await fetch(validationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body as Record<string, string>).toString(),
      });

      const validationText = await validationResponse.text();
      console.log("[PayFast Webhook] Validation response:", validationText);

      if (validationText !== "VALID") {
        console.error("[PayFast Webhook] PayFast validation failed");
        return new Response("Validation failed", { status: 400 });
      }
    } catch (error) {
      console.error("[PayFast Webhook] Validation request failed:", error);
      return new Response("Validation request failed", { status: 500 });
    }

    const paymentReference = fields.m_payment_id;
    const businessId = fields.custom_str2;
    const planId = fields.custom_str3;
    const subscriptionType = fields.custom_str1;
    const payfastStatus = fields.payment_status?.toUpperCase();
    const token = fields.token;

    console.log("[PayFast Webhook] Payment details", { paymentReference, businessId, planId, subscriptionType, payfastStatus, token });

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
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

        console.log("[PayFast Webhook] Subscription lookup", { subscription, error: fetchError });

      if (fetchError) throw new Error(fetchError.message);

      if (subscription) {
        // Initial ITN. For a trial this is the R0 tokenisation (card captured,
        // no charge) → 'trialing'. For a non-trial signup it's a real payment
        // → 'active'. Either way we store the PayFast token for future API ops.
        const isTrial = (subscription.metadata as any)?.trial === true;
        const newStatus = isTrial ? "trialing" : "active";
        console.log("[PayFast Webhook] Initial ITN", { subscriptionId: subscription.id, isTrial, newStatus, token });

        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: newStatus,
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

        console.log("[PayFast Webhook] Subscription", newStatus === "trialing" ? "trial started" : "activated");
      } else {
        // No incomplete sub → this is a recurring charge, OR the first real
        // charge that ends a trial. Match 'active' OR 'trialing'.
        console.log("[PayFast Webhook] No incomplete subscription; checking active/trialing subscription");

        const { data: existing } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", businessId)
          .eq("plan_id", planId)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          // Extend the billing period by one month from the current period end.
          const currentPeriodEnd = new Date(existing.current_period_end);
          const newPeriodEnd = new Date(currentPeriodEnd);
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

          const wasTrialing = existing.status === "trialing";

          const { error: updateError } = await supabase
            .from("subscriptions")
            .update({
              status: "active",   // a trial converts to active on its first charge
              current_period_end: newPeriodEnd.toISOString(),
              metadata: {
                ...existing.metadata,
                ...(wasTrialing ? { trial_converted_at: new Date().toISOString() } : {}),
                last_payment_reference: paymentReference,
                last_payment_at: new Date().toISOString(),
              },
            })
            .eq("id", existing.id);

          if (updateError) {
            console.error("[PayFast Webhook] Failed to process recurring charge", updateError);
            throw new Error(updateError.message);
          }

          console.log("[PayFast Webhook] Recurring charge processed", { wasTrialing });
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
        .order("created_at", { ascending: false })
        .limit(1)
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