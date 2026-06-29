import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { md5 } from "https://esm.sh/js-md5@0.8.3"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_PRICES: Record<string, number> = {
  Starter: 400,
  Growth: 1500,
  Business: 5000,
};

const PAYFAST_SANDBOX_URL =
  Deno.env.get("PAYFAST_SANDBOX_URL") || "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_PRODUCTION_URL =
  Deno.env.get("PAYFAST_PRODUCTION_URL") || "https://www.payfast.co.za/eng/process";
const PAYFAST_SANDBOX_MERCHANT_ID =
  Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY =
  Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE =
  Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
const PAYFAST_PRODUCTION_MERCHANT_ID =
  Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "";
const PAYFAST_PRODUCTION_MERCHANT_KEY =
  Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "";
const PAYFAST_PRODUCTION_PASSPHRASE =
  Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "";

// ─────────────────────────────────────────────────────────────────────────────
// PayFast Signature Generation
//
// IMPORTANT: PayFast has TWO different signature algorithms:
//
//   1. HTML Form / Checkout (this file): Fields must be in PayFast's DEFINED
//      ORDER — do NOT sort alphabetically. Alphabetical order is ONLY for the
//      PayFast server-to-server API, not for form submissions.
//
//   2. PayFast API (server-to-server): Fields sorted alphabetically.
//
// Mixing these two up is the most common cause of "signature mismatch" errors.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a single PayFast field value exactly as PayFast expects.
 *
 * Rules (per PayFast PHP sample code):
 *  - Use encodeURIComponent (percent-encode everything except unreserved chars)
 *  - Replace %20 with "+" (spaces become "+")
 *  - Do NOT trim — trimming can corrupt URLs and other values
 *  - Do NOT double-encode — encode once only
 */
function encodePayFastValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/**
 * Generates a PayFast signature for an HTML form checkout.
 *
 * Algorithm (matches official PayFast PHP sample):
 *  1. Take only the fields that will be submitted in the form
 *  2. Remove any field whose value is "", null, or undefined
 *  3. Preserve insertion order — do NOT sort alphabetically
 *  4. URL-encode each value (spaces → "+", no trimming)
 *  5. Join as key=value pairs separated by "&"
 *  6. If passphrase is non-empty, append "&passphrase=<encoded-passphrase>"
 *  7. MD5 hash the final string
 *
 * @param fields - Ordered Record of form fields (insertion order is preserved)
 * @param passphrase - Merchant passphrase; omitted from signature string if empty
 * @returns Lowercase hex MD5 hash
 */
function generatePayFastSignature(
  fields: Record<string, string>,
  passphrase: string,
): string {
  // Step 1–4: Filter empty values and encode, preserving insertion order
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === "" || value === null || value === undefined) {
      continue; // skip empty/missing fields
    }
    pairs.push(`${key}=${encodePayFastValue(value)}`);
  }

  // Step 5: Join
  let parameterString = pairs.join("&");

  // Step 6: Append passphrase only when non-empty
  if (passphrase && passphrase.length > 0) {
    parameterString += `&passphrase=${encodePayFastValue(passphrase)}`;
  }

  // Step 7: MD5 hash
  const signature = md5(parameterString);

  return signature;
}

/**
 * Diagnostic utility — prints every detail needed to debug a signature mismatch.
 * Call this before returning the PayFast response to compare against PayFast's calculation.
 */
function logSignatureDebugInfo(
  label: string,
  fields: Record<string, string>,
  passphrase: string,
  signature: string,
): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[PayFast Signature Debug] ${label}`);
  console.log("=".repeat(60));

  console.log("\n[Fields — raw values & lengths]");
  for (const [key, value] of Object.entries(fields)) {
    const isEmpty = value === "" || value === null || value === undefined;
    console.log(
      `  ${key.padEnd(22)} = ${JSON.stringify(value)} (len=${value?.length ?? 0}${isEmpty ? " ← SKIPPED" : ""})`,
    );
  }

  console.log("\n[Fields — encoded values in signature order]");
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === "" || value === null || value === undefined) continue;
    const encoded = encodePayFastValue(value);
    console.log(`  ${key.padEnd(22)} = ${encoded}`);
    pairs.push(`${key}=${encoded}`);
  }

  let parameterString = pairs.join("&");
  console.log("\n[Parameter string (before passphrase)]");
  console.log(`  ${parameterString}`);
  console.log(`  Length: ${parameterString.length}`);

  if (passphrase && passphrase.length > 0) {
    const encodedPassphrase = encodePayFastValue(passphrase);
    parameterString += `&passphrase=${encodedPassphrase}`;
    console.log("\n[Passphrase]");
    console.log(`  Raw    : ${JSON.stringify(passphrase)} (len=${passphrase.length})`);
    console.log(`  Encoded: ${encodedPassphrase}`);
  } else {
    console.log("\n[Passphrase] — NONE (not appended)");
  }

  console.log("\n[Final parameter string (MD5 input)]");
  console.log(`  ${parameterString}`);
  console.log(`  Length: ${parameterString.length}`);

  console.log("\n[Generated signature (MD5 output)]");
  console.log(`  ${signature}`);

  console.log("=".repeat(60) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Build PayFast fields in the exact order PayFast expects for HTML form checkout
//
// Official PayFast field order (from documentation):
//   merchant_id, merchant_key, return_url, cancel_url, notify_url,
//   name_first, name_last, email_address, cell_number (optional),
//   m_payment_id, amount, item_name, item_description,
//   custom_int1–5 (optional), custom_str1–5 (optional),
//   subscription_type, billing_date (optional), recurring_amount (optional),
//   frequency, cycles
//
// Fields are omitted from the object if their value is empty/undefined.
// Signature is generated from this object BEFORE adding 'signature' to it.
// ─────────────────────────────────────────────────────────────────────────────

function buildPayFastFields(opts: {
  merchantId: string;
  merchantKey: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  nameFirst: string;
  nameLast: string;
  emailAddress: string;
  mPaymentId: string;
  amount: string;      // Must be formatted as "193.00" — exactly 2 decimal places
  itemName: string;
  itemDescription: string;
  customStr1?: string;
  customStr2?: string;
  customStr3?: string;
  customStr4?: string;
  customStr5?: string;
  subscriptionType?: string;
  frequency?: string;
  cycles?: string;
}): Record<string, string> {
  // Build the fields object in the exact order PayFast expects.
  // JavaScript objects (V8/Deno) preserve insertion order for string keys.
  // Do NOT reorder these fields — order determines the signature.
  const fields: Record<string, string> = {};

  // Merchant details
  fields["merchant_id"]  = opts.merchantId;
  fields["merchant_key"] = opts.merchantKey;

  // URLs
  fields["return_url"] = opts.returnUrl;
  fields["cancel_url"] = opts.cancelUrl;
  fields["notify_url"] = opts.notifyUrl;

  // Customer details
  fields["name_first"]     = opts.nameFirst;
  fields["name_last"]      = opts.nameLast;
  fields["email_address"]  = opts.emailAddress;
  // cell_number omitted — not used

  // Transaction details
  fields["m_payment_id"]     = opts.mPaymentId;
  fields["amount"]           = opts.amount;
  fields["item_name"]        = opts.itemName;
  fields["item_description"] = opts.itemDescription;

  // Custom strings (only include if provided and non-empty)
  if (opts.customStr1) fields["custom_str1"] = opts.customStr1;
  if (opts.customStr2) fields["custom_str2"] = opts.customStr2;
  if (opts.customStr3) fields["custom_str3"] = opts.customStr3;
  if (opts.customStr4) fields["custom_str4"] = opts.customStr4;
  if (opts.customStr5) fields["custom_str5"] = opts.customStr5;

  // Subscription fields (only include if this is a subscription)
  if (opts.subscriptionType) fields["subscription_type"] = opts.subscriptionType;
  if (opts.frequency)        fields["frequency"]         = opts.frequency;
  if (opts.cycles)           fields["cycles"]            = opts.cycles;

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge Function Handler
// ─────────────────────────────────────────────────────────────────────────────

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

    // ─── GET /subscription-management — Fetch current subscription ───────────
    if (method === "GET" && path === "/subscription-management") {
      const { data: subscription, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);

      console.log("[Subscription Management] Fetched subscription:", JSON.stringify(subscription));

      // Handle custom plans - extract plan info from metadata
      if (subscription && subscription.plan_id && subscription.plan_id.startsWith("custom_")) {
        const customConfig = (subscription.metadata as any)?.custom_config;
        console.log("[Subscription Management] Custom config extracted:", JSON.stringify(customConfig));
        if (customConfig) {
          // Create a synthetic plan object from custom config
          const syntheticPlan = {
            id: subscription.plan_id,
            name: customConfig.name || "Custom Plan",
            price_cents: Math.round((customConfig.finalPrice || 0) * 100),
            billing_interval: "month",
            interval_count: 1,
            metadata: customConfig,
          };
          (subscription as any).plans = syntheticPlan;
          console.log("[Subscription Management] Synthetic plan created:", JSON.stringify(syntheticPlan));
        }
      } else if (subscription && subscription.plan_id) {
        // For regular plans, fetch from plans table
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("*")
          .eq("id", subscription.plan_id)
          .single();

        if (!planError && plan) {
          (subscription as any).plans = plan;
        }
      }

      return new Response(JSON.stringify(subscription), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ─── POST /subscription-management/payfast — Create PayFast subscription ─
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

      // Create incomplete subscription record
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

      // Build PayFast fields in the EXACT order PayFast expects
      // amount MUST be formatted with exactly 2 decimal places (e.g. "400.00")
      const fields = buildPayFastFields({
        merchantId:      PAYFAST_SANDBOX_MERCHANT_ID,
        merchantKey:     PAYFAST_SANDBOX_MERCHANT_KEY,
        returnUrl:       `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
        cancelUrl:       `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
        notifyUrl:       `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
        nameFirst:       "Bookza",
        nameLast:        "Subscription",
        emailAddress:    "subscriptions@bookza.co.za",
        mPaymentId:      subscriptionId,
        amount:          price.toFixed(2),   // Always exactly 2 decimal places
        itemName:        `Bookza ${planName} Subscription`,
        itemDescription: `Monthly subscription for ${planName} plan`,
        customStr1:      "bookza_subscription",
        customStr2:      business.id,
        customStr3:      planId,
        subscriptionType: "1",
        frequency:       "3",               // 3 = Monthly
        cycles:          "0",               // 0 = Indefinite
      });

      // Generate signature from fields BEFORE adding 'signature' to the object.
      // The passphrase is appended inside generatePayFastSignature — not as a field.
      const signature = generatePayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);

      // Log full debug info to help diagnose any future mismatch
      logSignatureDebugInfo(
        `POST /payfast — planName=${planName} subscriptionId=${subscriptionId}`,
        fields,
        PAYFAST_SANDBOX_PASSPHRASE,
        signature,
      );

      // Return the fields + signature to the frontend.
      // The frontend must submit EXACTLY this object as-is — no reordering,
      // no re-encoding, no type coercion.
      const responseFields = { ...fields, signature };

      console.log("[Subscription Management] Returning PayFast fields:", JSON.stringify(responseFields));
      console.log("[Subscription Management] PayFast action URL:", PAYFAST_SANDBOX_URL);

      return new Response(
        JSON.stringify({
          action: PAYFAST_SANDBOX_URL,
          subscriptionId,
          fields: responseFields,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        },
      );
    }

    // ─── POST /subscription-management/payfast/custom — Custom plan ──────────
    if (method === "POST" && path === "/subscription-management/payfast/custom") {
      const body = await req.json();
      const { customPlan, origin } = body;

      if (!customPlan || !customPlan.name) {
        return new Response("Invalid custom plan configuration", {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // amount must be a whole number of Rands, formatted as "NNN.00"
      const price = Math.round(customPlan.finalPrice || 0);
      if (price <= 0) {
        return new Response("Invalid price", {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      const subscriptionId = `bookza-custom-${Date.now()}`;
      const planId = `custom_${Date.now()}`;

      // Create custom plan in plans table
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const { error: planError } = await supabase
        .from("plans")
        .insert({
          id: planId,
          name: customPlan.name,
          price_cents: price * 100,
          billing_interval: "month",
          interval: "month",
          features: JSON.stringify(customPlan),
        });

      if (planError) {
        console.error("[Custom Plan] Failed to create plan:", planError);
        return new Response(JSON.stringify({ error: planError.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // Create incomplete subscription record
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
          metadata: {
            custom_config: customPlan,
          },
        });

      if (subscriptionError) {
        if (subscriptionError.message.includes("violates unique constraint")) {
          return new Response(
            JSON.stringify({ error: "You already have an active subscription" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
              },
            },
          );
        }
        return new Response(JSON.stringify({ error: subscriptionError.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // Build PayFast fields in the EXACT order PayFast expects
      const fields = buildPayFastFields({
        merchantId:      PAYFAST_SANDBOX_MERCHANT_ID,
        merchantKey:     PAYFAST_SANDBOX_MERCHANT_KEY,
        returnUrl:       `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
        cancelUrl:       `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
        notifyUrl:       `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
        nameFirst:       "Bookza",
        nameLast:        "Custom Plan",
        emailAddress:    "subscriptions@bookza.co.za",
        mPaymentId:      subscriptionId,
        amount:          price.toFixed(2),   // Always exactly 2 decimal places
        itemName:        `Bookza ${customPlan.name}`,
        itemDescription: `Monthly custom subscription - ${customPlan.name}`,
        customStr1:      "bookza_custom_subscription",
        customStr2:      business.id,
        customStr3:      planId,
        subscriptionType: "1",
        frequency:       "3",               // 3 = Monthly
        cycles:          "0",               // 0 = Indefinite
      });

      // Generate signature — fields object must NOT be modified after this point
      const signature = generatePayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);

      // Log full debug info
      logSignatureDebugInfo(
        `POST /payfast/custom — planName=${customPlan.name} subscriptionId=${subscriptionId}`,
        fields,
        PAYFAST_SANDBOX_PASSPHRASE,
        signature,
      );

      const responseFields = { ...fields, signature };

      console.log("[Subscription Management] Returning custom PayFast fields:", JSON.stringify(responseFields));
      console.log("[Subscription Management] PayFast action URL:", PAYFAST_SANDBOX_URL);

      return new Response(
        JSON.stringify({
          action: PAYFAST_SANDBOX_URL,
          subscriptionId,
          fields: responseFields,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        },
      );
    }

    // ─── POST /subscription-management/payfast/check-status ──────────────────
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

    // ─── PUT /subscription-management — Update subscription ──────────────────
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

        return new Response(
          JSON.stringify({
            ...updatedSubscription,
            message: "Downgrade scheduled for end of billing period",
          }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          },
        );
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

    // ─── DELETE /subscription-management — Cancel subscription ───────────────
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