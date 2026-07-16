import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { md5 } from "https://esm.sh/js-md5@0.8.3"

const PAYFAST_SANDBOX_MERCHANT_ID = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY = Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE = Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "34837169";
const PAYFAST_PRODUCTION_MERCHANT_KEY = Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "lbp3p79l1ljhz";
const PAYFAST_PRODUCTION_PASSPHRASE = Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "Qwickly2026DT";

function pickLatestSubscription<T extends { id?: string; created_at?: string | null }>(
  subscriptions: T[] | null | undefined,
): T | null {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return null;
  }

  return subscriptions.reduce<T | null>((latest, current) => {
    if (!latest) return current;

    const latestTime = latest.created_at ? Date.parse(latest.created_at) : 0;
    const currentTime = current.created_at ? Date.parse(current.created_at) : 0;

    return currentTime > latestTime ? current : latest;
  }, null);
}

function encodePayFastValue(value: string): string {
  // Must match PHP urlencode() exactly, because that's what PayFast uses to build
  // the ITN signature we validate against. encodeURIComponent leaves these six
  // characters unescaped; urlencode escapes them:  ! ' ( ) * ~
  //
  // Missing this made the webhook reject any ITN whose fields contained one — e.g.
  // an add-on's item_description "(14 of 14 days)". Values without them (token
  // bundle descriptions, amounts, IDs) validated fine, which is why only add-ons
  // broke. This is the same fix already applied in subscription-management's copy.
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(
      /[!'()*~]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
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

// Self-contained PayFast subscription-amount update, used to raise the recurring
// amount after an add-on's pro-rata payment settles. Kept inline here (rather than
// shared with subscription-management) to avoid a cross-function dependency — the
// two copies are small and change rarely.
//
// The signature covers ONLY PayFast's variables (merchant-id, version, timestamp,
// body), alphabetised. Content-Type is a transport header and must NOT be signed —
// signing it is what caused "signature does not match" failures.
async function updatePayFastRecurringAmount(
  payfastToken: string,
  amountCents: number,
): Promise<boolean> {
  const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
  const merchantId = isSandbox ? PAYFAST_SANDBOX_MERCHANT_ID : PAYFAST_PRODUCTION_MERCHANT_ID;
  const passphrase = isSandbox ? PAYFAST_SANDBOX_PASSPHRASE : PAYFAST_PRODUCTION_PASSPHRASE;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const signedVars: Record<string, string> = {
    "merchant-id": merchantId,
    version: "v1",
    timestamp,
  };
  const body: Record<string, string> = { amount: String(amountCents) };

  // ⚠️ PayFast's SERVER-TO-SERVER API signature is not the same as the checkout/
  // ITN one. For the API, the passphrase is one of the fields that gets sorted
  // ALPHABETICALLY — NOT appended at the end. Appending it (the checkout rule)
  // returns 401 "Merchant authorization failed". Matches PayFast's PHP sample:
  // add passphrase to the data, ksort, urlencode each non-empty value, md5.
  const all: Record<string, string> = { ...signedVars, ...body, passphrase };
  const parameterString = Object.keys(all)
    .sort()
    .filter((k) => all[k] !== "")
    .map((k) => `${k}=${encodePayFastValue(all[k])}`)
    .join("&");
  const signature = md5(parameterString);
  console.log("[PayFast Webhook] API signature string:", parameterString);

  // passphrase is used ONLY in the signature — it is never sent as a header.

  const url = `https://api.payfast.co.za/subscriptions/${payfastToken}/update?testing=${isSandbox}`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { ...signedVars, signature, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      console.error("[PayFast Webhook] Recurring amount update failed", {
        status: response.status,
        response: text,
      });
      return false;
    }
    console.log("[PayFast Webhook] Recurring amount updated", { amountCents, response: text });
    return true;
  } catch (error) {
    console.error("[PayFast Webhook] Recurring amount update threw", error);
    return false;
  }
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

    // ─── Add-on pro-rata payment ─────────────────────────────────────────────
    // Settles the partial-period charge for an add-on attached mid-cycle. Only
    // once this lands does the add-on go live and the recurring amount go up —
    // so an abandoned checkout grants nothing and bills nothing.
    //
    // Unlike a credit bundle, the amount can't be re-derived here: a pro-rata
    // figure depends on the day it was quoted. So the quote was recorded in
    // subscription_addon_purchases and is checked against what was actually paid.
    if (subscriptionType === "qwickly_addon_proration") {
      const { data: purchase, error: purchaseError } = await supabase
        .from("subscription_addon_purchases")
        .select("id, subscription_id, business_id, addon_id, quantity, amount_cents, status")
        .eq("payment_ref", paymentReference)
        .maybeSingle();

      if (purchaseError) throw new Error(purchaseError.message);
      if (!purchase) {
        console.error("[PayFast Webhook] Unknown add-on purchase reference", { paymentReference });
        return new Response("Unknown purchase", { status: 400 });
      }

      if (payfastStatus !== "COMPLETE") {
        await supabase
          .from("subscription_addon_purchases")
          .update({ status: "failed" })
          .eq("id", purchase.id)
          .eq("status", "pending");

        console.log("[PayFast Webhook] Add-on payment not complete", {
          paymentReference,
          payfastStatus,
        });
        return new Response("OK", { status: 200 });
      }

      // Idempotency: PayFast retries ITNs, and attaching twice would double-bill
      // on the recurring amount.
      if (purchase.status === "completed") {
        console.log("[PayFast Webhook] Add-on purchase already settled", { paymentReference });
        return new Response("OK", { status: 200 });
      }

      const expectedAmount = (Number(purchase.amount_cents) / 100).toFixed(2);
      const paidAmount = Number(fields.amount_gross ?? 0).toFixed(2);

      if (expectedAmount !== paidAmount) {
        console.error("[PayFast Webhook] Add-on payment amount mismatch — refusing to attach", {
          paymentReference,
          expectedAmount,
          paidAmount,
        });
        return new Response("Amount mismatch", { status: 400 });
      }

      // Paid — attach it.
      const { error: attachError } = await supabase
        .from("subscription_addons")
        .upsert(
          {
            subscription_id: purchase.subscription_id,
            addon_id: purchase.addon_id,
            quantity: purchase.quantity,
            remove_at: null,
          },
          { onConflict: "subscription_id,addon_id" },
        );

      if (attachError) {
        console.error("[PayFast Webhook] Failed to attach paid add-on", {
          paymentReference,
          error: attachError.message,
        });
        // 500 so PayFast retries: they've paid, so failing to attach silently is
        // the one outcome we can't accept.
        return new Response("Failed to attach add-on", { status: 500 });
      }

      await supabase
        .from("subscription_addon_purchases")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", purchase.id);

      // Now raise the recurring amount so every FUTURE month includes it.
      const { data: subscriptionRow } = await supabase
        .from("subscriptions")
        .select("payfast_token, plans!subscriptions_plan_id_fkey(price_cents)")
        .eq("id", purchase.subscription_id)
        .maybeSingle();

      const { data: renewingAddons } = await supabase
        .from("subscription_addons")
        .select("quantity, plan_addons!inner(price_cents)")
        .eq("subscription_id", purchase.subscription_id)
        .is("remove_at", null);

      const planRel = subscriptionRow?.plans as any;
      const planRow = Array.isArray(planRel) ? planRel[0] : planRel;
      const planCents = Number(planRow?.price_cents ?? 0);
      const addonCents = (renewingAddons ?? []).reduce((sum: number, row: any) => {
        const catalog = Array.isArray(row.plan_addons) ? row.plan_addons[0] : row.plan_addons;
        return sum + Number(catalog?.price_cents ?? 0) * Number(row.quantity ?? 1);
      }, 0);
      const totalCents = planCents + addonCents;

      if (subscriptionRow?.payfast_token) {
        const updated = await updatePayFastRecurringAmount(
          subscriptionRow.payfast_token,
          totalCents,
        );

        if (!updated) {
          // The add-on IS attached and paid for this period — that part is correct.
          // But future months would still bill the old amount, so this needs a human.
          console.error(
            "[PayFast Webhook] ATTENTION: add-on attached and paid, but the recurring " +
              "amount could not be updated. Future charges will be too low until fixed.",
            { paymentReference, subscriptionId: purchase.subscription_id, totalCents },
          );
        }
      }

      console.log("[PayFast Webhook] Add-on settled and attached", {
        paymentReference,
        addonId: purchase.addon_id,
        newMonthlyTotalCents: totalCents,
      });

      return new Response("OK", { status: 200 });
    }


    // ─── Credit bundle top-up ────────────────────────────────────────────────
    // A one-time payment, not a subscription. Must be handled BEFORE the
    // subscription logic below, which would treat custom_str3 as a plan_id, find
    // no matching subscription, and silently do nothing.
    //
    // custom_str3 is the bundle id. The amount is re-derived from credit_bundles
    // and checked against amount_gross — the signature already covers the amount,
    // but verifying independently means a signature bug can't become a pricing hole.
    if (subscriptionType === "qwickly_credit_purchase") {
      if (payfastStatus !== "COMPLETE") {
        // Not an error — a cancelled/failed payment just grants nothing. Return
        // 200 so PayFast stops retrying.
        console.log("[PayFast Webhook] Credit purchase not complete, ignoring", {
          paymentReference,
          payfastStatus,
        });
        return new Response("OK", { status: 200 });
      }

      const { data: bundle, error: bundleError } = await supabase
        .from("credit_bundles")
        .select("id, kind, amount, price_cents")
        .eq("id", planId)
        .maybeSingle();

      if (bundleError) throw new Error(bundleError.message);
      if (!bundle) {
        console.error("[PayFast Webhook] Unknown credit bundle", { bundleId: planId, paymentReference });
        return new Response("Unknown bundle", { status: 400 });
      }

      const expectedAmount = (Number(bundle.price_cents) / 100).toFixed(2);
      const paidAmount = Number(fields.amount_gross ?? 0).toFixed(2);

      if (expectedAmount !== paidAmount) {
        // Never grant on a mismatch. Someone paid an amount we didn't ask for.
        console.error("[PayFast Webhook] Credit purchase amount mismatch — refusing to grant", {
          paymentReference,
          bundleId: bundle.id,
          expectedAmount,
          paidAmount,
        });
        return new Response("Amount mismatch", { status: 400 });
      }

      // grant_credits is idempotent on p_ref_id, so PayFast's ITN retries credit
      // exactly once.
      const { data: grantResult, error: grantError } = await supabase.rpc("grant_credits", {
        p_business_id: businessId,
        p_kind: bundle.kind,
        p_amount: bundle.amount,
        p_source: "purchase",
        p_reason: `bundle:${bundle.id}`,
        p_ref_id: paymentReference,
      });

      if (grantError) {
        // Return 500 so PayFast retries — the payment succeeded, so failing to
        // credit is the one outcome we must not accept silently.
        console.error("[PayFast Webhook] grant_credits failed", {
          paymentReference,
          error: grantError.message,
        });
        return new Response("Failed to grant credits", { status: 500 });
      }

      console.log("[PayFast Webhook] Credits granted", {
        paymentReference,
        businessId,
        bundleId: bundle.id,
        kind: bundle.kind,
        amount: bundle.amount,
        result: grantResult,
      });

      return new Response("OK", { status: 200 });
    }

    if (payfastStatus === "COMPLETE") {
      // Get the most recent incomplete subscription, if one exists.
      // Some flows can create duplicate incomplete rows, so we need to tolerate that
      // and use the latest record rather than failing on a multi-row result.
      const { data: matchingSubscriptions, error: fetchError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .order("created_at", { ascending: false });

      const subscription = pickLatestSubscription(matchingSubscriptions as any[] | null);

      console.log("[PayFast Webhook] Subscription lookup", { subscription, matchingCount: matchingSubscriptions?.length ?? 0, error: fetchError });

      if (fetchError) throw new Error(fetchError.message);

      if (subscription) {
        // Initial ITN. For a trial this is the R0 tokenisation (card captured,
        // no charge) → 'trialing'. For a non-trial signup it's a real payment
        // → 'active'. Either way we store the PayFast token for future API ops.
        // A trial's initial ITN is the R0 card tokenisation (no charge) → the
        // subscription should sit in 'trialing' until the first real charge on
        // day 14 converts it to 'active' (handled in the else-branch below). This
        // was hardcoded to "active", so trials never actually entered 'trialing'
        // — which meant the trial UI badge and the free trial-feature grants
        // (chatbot/analytics/branded email) never applied.
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

        // Burn the business's one-trial allowance the moment a trial actually
        // starts (migration 056). Only-if-null so it records the FIRST trial and
        // can't be pushed forward by later activity.
        if (newStatus === "trialing") {
          const { error: trialFlagError } = await supabase
            .from("businesses")
            .update({ trial_used_at: new Date().toISOString() })
            .eq("id", businessId)
            .is("trial_used_at", null);
          if (trialFlagError) {
            console.error("[PayFast Webhook] Failed to record trial_used_at", trialFlagError);
          }
        }

        console.log("[PayFast Webhook] Subscription", newStatus === "trialing" ? "trial started" : "activated");
      } else {
        // No incomplete sub → this is a recurring charge, OR the first real
        // charge that ends a trial. Match 'active' OR 'trialing'.
        console.log("[PayFast Webhook] No incomplete subscription; checking active/trialing subscription");

        const { data: existingSubscriptions } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", businessId)
          .eq("plan_id", planId)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false });

        const existing = pickLatestSubscription(existingSubscriptions as any[] | null);

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
      const { data: matchingSubscriptions } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", businessId)
        .eq("plan_id", planId)
        .eq("status", "incomplete")
        .order("created_at", { ascending: false });

      const subscription = pickLatestSubscription(matchingSubscriptions as any[] | null);

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