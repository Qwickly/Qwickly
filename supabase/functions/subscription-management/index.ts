  import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  import { md5 } from "https://esm.sh/js-md5@0.8.3";

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  // NOTE: there is deliberately no hardcoded price map here. Plan prices and
  // availability come from the `plans` table (id, price_cents, is_active) so that a
  // repricing migration can't silently disagree with what checkout charges — which
  // is exactly what happened when 051 moved Starter to R129 while the old map still
  // said 99. Credit bundle prices come from `credit_bundles` for the same reason.

  const PAYFAST_SANDBOX_URL =
    Deno.env.get("PAYFAST_SANDBOX_URL") ||
    "https://sandbox.payfast.co.za/eng/process";
  const PAYFAST_PRODUCTION_URL =
    Deno.env.get("PAYFAST_PRODUCTION_URL") ||
    "https://www.payfast.co.za/eng/process";
  const PAYFAST_SANDBOX_MERCHANT_ID =
    Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200";
  const PAYFAST_SANDBOX_MERCHANT_KEY =
    Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY") || "ztgkjo0djf02j";
  const PAYFAST_SANDBOX_PASSPHRASE =
    Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";
  const PAYFAST_PRODUCTION_MERCHANT_ID =
    Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "34837169";
  const PAYFAST_PRODUCTION_MERCHANT_KEY =
    Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_KEY") || "lbp3p79l1ljhz";
  const PAYFAST_PRODUCTION_PASSPHRASE =
    Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "Qwickly2026DT";

  /**
   * Resolves which PayFast credentials + checkout URL to use for form submissions.
   * Set the `PAYFAST_MODE=sandbox` secret to route checkout to the PayFast sandbox
   * (safe testing — no real money, no real card tokens). Anything else = production.
   * Mirrors the isSandbox switch already used by the API + webhook functions.
   */
  function resolvePayFastCheckout() {
    const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
    return {
      isSandbox,
      merchantId: isSandbox
        ? PAYFAST_SANDBOX_MERCHANT_ID
        : PAYFAST_PRODUCTION_MERCHANT_ID,
      merchantKey: isSandbox
        ? PAYFAST_SANDBOX_MERCHANT_KEY
        : PAYFAST_PRODUCTION_MERCHANT_KEY,
      passphrase: isSandbox
        ? PAYFAST_SANDBOX_PASSPHRASE
        : PAYFAST_PRODUCTION_PASSPHRASE,
      processUrl: isSandbox ? PAYFAST_SANDBOX_URL : PAYFAST_PRODUCTION_URL,
    };
  }

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
   * Encodes a single PayFast field value exactly as PHP's urlencode() does — which
   * is what PayFast uses to build their side of the signature.
   *
   * ⚠️ encodeURIComponent IS NOT urlencode. It leaves these six characters alone:
   *
   *     ! ' ( ) * ~
   *
   * PHP's urlencode() escapes all of them. So any field value containing one
   * produced a signature PayFast could never match ("Generated signature does not
   * match submitted signature"). That's why a credit bundle checkout worked but an
   * add-on didn't: the add-on's item_description has "(11 of 31 days)". It would
   * also break checkout for any business named e.g. "Joe's Barbers" (apostrophe).
   *
   * Rules (per PayFast PHP sample code):
   *  - Escape everything except A-Z a-z 0-9 - _ .
   *  - Spaces become "+"
   *  - Do NOT trim — trimming can corrupt URLs and other values
   *  - Do NOT double-encode — encode once only
   */
  /** JSON reply with the CORS headers every response in this function carries. */
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  function encodePayFastValue(value: string): string {
    return encodeURIComponent(value)
      .replace(/%20/g, "+")
      .replace(
        /[!'()*~]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
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
      console.log(
        `  Raw    : ${JSON.stringify(passphrase)} (len=${passphrase.length})`,
      );
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
    amount: string; // Must be formatted as "193.00" — exactly 2 decimal places
    itemName: string;
    itemDescription: string;
    customStr1?: string;
    customStr2?: string;
    customStr3?: string;
    customStr4?: string;
    customStr5?: string;
    subscriptionType?: string;
    billingDate?: string; // YYYY-MM-DD — first recurring charge date (trial end)
    recurringAmount?: string; // real monthly amount (when initial `amount` is 0 for a trial)
    frequency?: string;
    cycles?: string;
  }): Record<string, string> {
    // Build the fields object in the exact order PayFast expects.
    // JavaScript objects (V8/Deno) preserve insertion order for string keys.
    // Do NOT reorder these fields — order determines the signature.
    const fields: Record<string, string> = {};

    // Merchant details
    fields["merchant_id"] = opts.merchantId;
    fields["merchant_key"] = opts.merchantKey;

    // URLs
    fields["return_url"] = opts.returnUrl;
    fields["cancel_url"] = opts.cancelUrl;
    fields["notify_url"] = opts.notifyUrl;

    // Customer details
    fields["name_first"] = opts.nameFirst;
    fields["name_last"] = opts.nameLast;
    fields["email_address"] = opts.emailAddress;
    // cell_number omitted — not used

    // Transaction details
    fields["m_payment_id"] = opts.mPaymentId;
    fields["amount"] = opts.amount;
    fields["item_name"] = opts.itemName;
    fields["item_description"] = opts.itemDescription;

    // Custom strings (only include if provided and non-empty)
    if (opts.customStr1) fields["custom_str1"] = opts.customStr1;
    if (opts.customStr2) fields["custom_str2"] = opts.customStr2;
    if (opts.customStr3) fields["custom_str3"] = opts.customStr3;
    if (opts.customStr4) fields["custom_str4"] = opts.customStr4;
    if (opts.customStr5) fields["custom_str5"] = opts.customStr5;

    // Subscription fields (only include if this is a subscription).
    // Order matters for the signature — PayFast's defined order is:
    //   subscription_type, billing_date, recurring_amount, frequency, cycles
    if (opts.subscriptionType)
      fields["subscription_type"] = opts.subscriptionType;
    if (opts.billingDate) fields["billing_date"] = opts.billingDate;
    if (opts.recurringAmount) fields["recurring_amount"] = opts.recurringAmount;
    if (opts.frequency) fields["frequency"] = opts.frequency;
    if (opts.cycles) fields["cycles"] = opts.cycles;

    return fields;
  }

  /**
   * Generates a PayFast API signature for server-to-server API calls
   *
   * According to official PayFast documentation:
   * - Signature is MD5 hash of alphabetised header AND body variables together with passphrase
   * - Characters must be in lower case
   * - URL encoding: standard URL encoding (spaces become %20)
   */
  function generatePayFastApiSignature(
    headers: Record<string, string>,
    body: Record<string, string> = {},
    passphrase: string,
  ): string {
    // Combine headers and body for signature
    const allFields: Record<string, string> = {
      ...headers,
      ...body,
    };

    // Remove signature field itself if present
    delete allFields.signature;

    // ⚠️ Content-Type is an HTTP transport header, NOT a PayFast signed variable.
    // PayFast signs only its own header vars (merchant-id, version, timestamp) plus
    // the body. Including Content-Type here injected an extra
    // `Content-Type=application/json` pair that PayFast never has on its side, so
    // every update/cancel failed with "signature does not match". Stripping it here
    // fixes all callers at once, with no change to how they build their headers.
    delete allFields["Content-Type"];
    delete allFields["content-type"];

    // ⚠️ For the SERVER-TO-SERVER API, the passphrase is one of the fields that
    // gets sorted ALPHABETICALLY — it is NOT appended at the end (that's the
    // checkout/ITN rule). This used to append it, which returned 401 "Merchant
    // authorization failed". Matches PayFast's PHP sample: add passphrase to the
    // data, ksort, urlencode each non-empty value, md5.
    if (passphrase && passphrase.length > 0) {
      allFields["passphrase"] = passphrase;
    }

    // Sort fields alphabetically (passphrase now participates in the sort)
    const sortedKeys = Object.keys(allFields).sort();
    const pairs: string[] = [];

    for (const key of sortedKeys) {
      const value = allFields[key];
      if (value === "" || value === null || value === undefined) continue;
      pairs.push(`${key}=${encodePayFastValue(value)}`);
    }

    const parameterString = pairs.join("&");

    console.log("[PayFast API Signature] Parameter string:", parameterString);

    // Generate MD5 hash (lowercase)
    return md5(parameterString);
  }

  /**
   * Generates ISO-8601 timestamp without timezone
   * Format: YYYY-MM-DDTHH:MM:SS
   */
  function generateApiTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  /**
   * Updates a PayFast subscription using their API
   *
   * According to official PayFast documentation:
   * - Endpoint: PATCH https://api.payfast.co.za/subscriptions/{token}/update?testing=true
   * - Headers: merchant-id, version, timestamp, signature
   * - Body: at least one of: cycles, frequency, run_date, amount (in cents)
   * - Signature: MD5 hash of alphabetised header + body variables + passphrase
   * - Timestamp: ISO-8601 format YYYY-MM-DDTHH:MM:SS
   */
  async function updatePayFastSubscription(
    payfastToken: string,
    updates: {
      amount?: number;
      cycles?: number;
      frequency?: number;
      run_date?: string;
    },
  ): Promise<boolean> {
    const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
    const merchantId = isSandbox
      ? PAYFAST_SANDBOX_MERCHANT_ID
      : PAYFAST_PRODUCTION_MERCHANT_ID;
    const passphrase = isSandbox
      ? PAYFAST_SANDBOX_PASSPHRASE
      : PAYFAST_PRODUCTION_PASSPHRASE;

    // Generate ISO-8601 timestamp without timezone
    const timestamp = generateApiTimestamp();

    // Build headers (PayFast expects these specific headers)
    const headers: Record<string, string> = {
      "merchant-id": merchantId,
      version: "v1",
      timestamp: timestamp,
      "Content-Type": "application/json",
    };

    // Build body with updates
    const body: Record<string, string> = {};
    if (updates.amount !== undefined) {
      body.amount = String(updates.amount); // Amount in cents
    }
    if (updates.cycles !== undefined) {
      body.cycles = String(updates.cycles);
    }
    if (updates.frequency !== undefined) {
      body.frequency = String(updates.frequency);
    }
    if (updates.run_date !== undefined) {
      body.run_date = updates.run_date;
    }

    // Generate signature from headers + body + passphrase
    const signature = generatePayFastApiSignature(headers, body, passphrase);

    // Add signature to headers
    headers.signature = signature;

    console.log("[PayFast Update] Updating subscription");
    console.log("[PayFast Update] Token:", payfastToken);
    console.log(
      "[PayFast Update] URL:",
      `https://api.payfast.co.za/subscriptions/${payfastToken}/update?testing=true`,
    );
    console.log("[PayFast Update] Timestamp:", timestamp);
    console.log("[PayFast Update] Body:", JSON.stringify(body));
    console.log("[PayFast Update] Headers:", JSON.stringify(headers));

    // testing MUST track the mode. Hardcoded true would make every call a no-op in
    // production (PayFast treats testing=true as a dry run).
    const updateUrl = `https://api.payfast.co.za/subscriptions/${payfastToken}/update?testing=${isSandbox}`;

    const response = await fetch(updateUrl, {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    console.log("[PayFast Update] Response status:", response.status);
    console.log("[PayFast Update] Response body:", responseText);

    // PayFast returns 200 for success
    if (response.ok) {
      console.log(
        "[PayFast Update] Successfully updated subscription on PayFast",
      );
      return true;
    }

    console.error(
      "[PayFast Update] Failed to update subscription on PayFast:",
      responseText,
    );
    return false;
  }

  /**
   * Fetches PayFast's own view of a subscription (amount, run_date, status_text).
   * Diagnostic only — used by GET /payfast/status to confirm what PayFast will
   * actually do, versus what our database thinks. Returns null on any failure.
   */
  async function fetchPayFastSubscription(
    payfastToken: string,
  ): Promise<Record<string, unknown> | null> {
    const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
    const merchantId = isSandbox
      ? PAYFAST_SANDBOX_MERCHANT_ID
      : PAYFAST_PRODUCTION_MERCHANT_ID;
    const passphrase = isSandbox
      ? PAYFAST_SANDBOX_PASSPHRASE
      : PAYFAST_PRODUCTION_PASSPHRASE;

    // Only PayFast's signed vars — Content-Type is added to the request afterwards,
    // and generatePayFastApiSignature strips it anyway.
    const signedVars: Record<string, string> = {
      "merchant-id": merchantId,
      version: "v1",
      timestamp: generateApiTimestamp(),
    };
    const signature = generatePayFastApiSignature(signedVars, {}, passphrase);

    const url = `https://api.payfast.co.za/subscriptions/${payfastToken}/fetch?testing=${isSandbox}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...signedVars, signature, "Content-Type": "application/json" },
      });
      const text = await response.text().catch(() => "");
      if (!response.ok) {
        console.error("[PayFast Fetch] Failed", { status: response.status, response: text });
        return null;
      }
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        console.error("[PayFast Fetch] Non-JSON response", { response: text });
        return null;
      }
    } catch (error) {
      console.error("[PayFast Fetch] Request threw", error);
      return null;
    }
  }

  /**
   * Cancels a PayFast subscription using their API
   *
   * According to official PayFast documentation:
   * - Endpoint: PUT https://api.payfast.co.za/subscriptions/{token}/cancel?testing=true
   * - Headers: merchant-id, version, timestamp, signature
   * - Body: empty (no body data for cancel)
   * - Signature: MD5 hash of alphabetised header + body variables + passphrase
   * - Timestamp: ISO-8601 format YYYY-MM-DDTHH:MM:SS
   */
  async function cancelPayFastSubscription(
    payfastToken: string,
  ): Promise<boolean> {
    const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
    const merchantId = isSandbox
      ? PAYFAST_SANDBOX_MERCHANT_ID
      : PAYFAST_PRODUCTION_MERCHANT_ID;
    const passphrase = isSandbox
      ? PAYFAST_SANDBOX_PASSPHRASE
      : PAYFAST_PRODUCTION_PASSPHRASE;

    // Generate ISO-8601 timestamp without timezone
    const timestamp = generateApiTimestamp();

    // Build headers (PayFast expects these specific headers)
    const headers: Record<string, string> = {
      "merchant-id": merchantId,
      version: "v1",
      timestamp: timestamp,
      "Content-Type": "application/json",
    };

    // Body is empty for cancel endpoint
    const body: Record<string, string> = {};

    // Generate signature from headers + body + passphrase
    const signature = generatePayFastApiSignature(headers, body, passphrase);

    // Add signature to headers
    headers.signature = signature;

    // testing MUST track the mode — same rule as updatePayFastSubscription above.
    // Hardcoded true made every production cancel a dry run: PayFast reported
    // success but kept the subscription ACTIVE and kept charging the customer.
    const cancelUrl = `https://api.payfast.co.za/subscriptions/${payfastToken}/cancel?testing=${isSandbox}`;

    console.log("[PayFast Cancel] Cancelling subscription");
    console.log("[PayFast Cancel] Token:", payfastToken);
    console.log("[PayFast Cancel] URL:", cancelUrl);
    console.log("[PayFast Cancel] Timestamp:", timestamp);
    console.log("[PayFast Cancel] Headers:", JSON.stringify(headers));

    const response = await fetch(cancelUrl, {
      method: "PUT",
      headers: headers,
    });

    const responseText = await response.text();
    console.log("[PayFast Cancel] Response status:", response.status);
    console.log("[PayFast Cancel] Response body:", responseText);

    // PayFast returns 200 for success
    if (response.ok) {
      console.log(
        "[PayFast Cancel] Successfully cancelled subscription on PayFast",
      );
      return true;
    }

    console.error(
      "[PayFast Cancel] Failed to cancel subscription on PayFast:",
      responseText,
    );
    return false;
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
    const rawPath = (url.pathname || "/").replace(/\/+$/, "") || "/";
    const functionPrefix = "/functions/v1/subscription-management";
    const path = rawPath.startsWith(functionPrefix)
      ? rawPath.slice(functionPrefix.length) || "/"
      : rawPath;
    const route = path.startsWith("/subscription-management")
      ? path
      : `/subscription-management${path}`;

    console.log(`[Subscription Management] ${method} rawPath=${rawPath} path=${path} route=${route}`);

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
        return new Response("Unauthorized", {
          status: 401,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return new Response("Invalid token", {
          status: 401,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // Get business for user
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (businessError || !business) {
        return new Response("Business not found", {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // ─── GET /subscription-management — Fetch current subscription ───────────
      if (method === "GET" && path === "/subscription-management") {
        const { data: subscription, error } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw new Error(error.message);

        console.log(
          "[Subscription Management] Fetched subscription:",
          JSON.stringify(subscription),
        );

        // Handle custom plans - extract plan info from metadata
        if (
          subscription &&
          subscription.plan_id &&
          subscription.plan_id.startsWith("custom_")
        ) {
          const customConfig = (subscription.metadata as any)?.custom_config;
          console.log(
            "[Subscription Management] Custom config extracted:",
            JSON.stringify(customConfig),
          );
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
            console.log(
              "[Subscription Management] Synthetic plan created:",
              JSON.stringify(syntheticPlan),
            );
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
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── POST /subscription-management/trial — Start a card-free free trial ──
      // The trial used to be a PayFast round trip: a zero-amount subscription
      // that captured a card without charging it, with PayFast's day-14 recurring
      // charge doing double duty as "the trial ended" and "they converted".
      //
      // That put the highest-friction step in the whole product — leave the app,
      // type in a card — at the exact moment the customer is least committed. It
      // also rested on a zero-amount subscription that some PayFast merchant
      // configs reject outright.
      //
      // Now a trial is just a row. No redirect, no card, no PayFast. What that
      // costs us is that nothing outside our own code ends it any more: expiry is
      // enforced by entitlements.ts on every read, and tidied by the hourly sweep
      // in subscription-charger.ts.
      if (method === "POST" && path === "/subscription-management/trial") {
        // How long a trial runs when the plan row does not say. The plans table is
        // the source of truth, but a plan seeded with trial_days = 0 would
        // silently mint a trial that expired the instant it was created — a much
        // worse failure than a wrong-but-sane default.
        const DEFAULT_TRIAL_DAYS = 14;

        let planName = "Starter";
        try {
          const body = await req.json();
          if (body && typeof body.planName === "string" && body.planName.trim()) {
            planName = body.planName.trim();
          }
        } catch {
          // No body is fine — the default plan is the point.
        }

        const planId = `${planName.toLowerCase()}_monthly`;

        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("*")
          .eq("id", planId)
          .eq("is_active", true)
          .maybeSingle();

        if (planError) throw new Error(planError.message);
        if (!plan) return jsonResponse({ error: "plan_not_found" }, 400);

        // Already paying or already trialling — say so rather than stacking a
        // second row on top of it.
        const { data: liveSub, error: liveSubError } = await supabase
          .from("subscriptions")
          .select("id, status")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .limit(1)
          .maybeSingle();

        if (liveSubError) throw new Error(liveSubError.message);
        if (liveSub) {
          return jsonResponse({ error: "already_subscribed", status: liveSub.status }, 409);
        }

        // Eligibility has two halves and both must pass. businesses.trial_used_at
        // stops one business trialling twice; trial_grants stops one person
        // spinning up businesses to trial forever, which with no card at the door
        // is otherwise a thirty-second loop.
        const { data: businessRow, error: businessRowError } = await supabase
          .from("businesses")
          .select("trial_used_at")
          .eq("id", business.id)
          .maybeSingle();

        if (businessRowError) throw new Error(businessRowError.message);
        if (businessRow?.trial_used_at) {
          return jsonResponse({ error: "trial_already_used" }, 409);
        }

        const trialDays =
          Number(plan.trial_days) > 0 ? Number(plan.trial_days) : DEFAULT_TRIAL_DAYS;

        const now = new Date();
        const trialEnds = new Date(now);
        trialEnds.setDate(trialEnds.getDate() + trialDays);

        // Claim the user-level grant FIRST. The primary key on user_id makes this
        // the concurrency guard for the whole endpoint: a double-clicked "Start
        // trial", or two tabs racing, loses on the unique violation instead of
        // creating a second subscription. It is released below if anything after
        // it fails, so this never costs a genuine customer their trial.
        const { error: grantError } = await supabase.from("trial_grants").insert({
          user_id: user.id,
          business_id: business.id,
          granted_at: now.toISOString(),
          expires_at: trialEnds.toISOString(),
        });

        if (grantError) {
          if (grantError.message.includes("duplicate key")) {
            return jsonResponse({ error: "trial_already_used" }, 409);
          }
          throw new Error(grantError.message);
        }

        const { data: created, error: createError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: user.id,
            business_id: business.id,
            plan_id: planId,
            // Straight to 'trialing'. The old flow parked the row at 'incomplete'
            // because a trial was not real until PayFast confirmed the card.
            // There is nothing left to confirm.
            status: "trialing",
            current_period_start: now.toISOString(),
            current_period_end: trialEnds.toISOString(),
            cancel_at_period_end: false,
            payfast_token: null,
            metadata: {
              trial: true,
              trial_days: trialDays,
              trial_ends_at: trialEnds.toISOString(),
              // Read by the conversion path: no card was captured, so there is no
              // token to bill and converting means a full PayFast checkout.
              card_on_file: false,
            },
          })
          .select("*")
          .single();

        if (createError) {
          // Release the claim — this user never actually got a trial.
          await supabase.from("trial_grants").delete().eq("user_id", user.id);
          throw new Error(createError.message);
        }

        const { error: stampError } = await supabase
          .from("businesses")
          .update({ trial_used_at: now.toISOString() })
          .eq("id", business.id)
          .is("trial_used_at", null);

        if (stampError) {
          // Not fatal: trial_grants already blocks a repeat for this user and the
          // subscription is live. Worth logging loudly, not worth tearing down a
          // working trial for.
          console.error("[Subscription Management] Failed to stamp trial_used_at", stampError);
        }

        console.log(
          `[Subscription Management] Card-free trial started — business=${business.id} plan=${planId} days=${trialDays} ends=${trialEnds.toISOString()}`,
        );

        // Same shape as GET /subscription-management, so the client maps it with
        // the code it already has.
        return jsonResponse({ ...created, plans: plan }, 201);
      }

      // ─── POST /subscription-management/payfast — Create PayFast subscription ─
      if (method === "POST" && path === "/subscription-management/payfast") {
        const body = await req.json();
        const { planName, origin } = body;

        if (!planName || typeof planName !== "string") {
          return new Response("Invalid plan name", { status: 400 });
        }

        const subscriptionId = `qwickly-sub-${Date.now()}`;
        const planId = `${planName.toLowerCase()}_monthly`;

        // The plans table is the single source of truth for price and availability.
        // This used a hardcoded PLAN_PRICES map, which drifted the moment migration
        // 051 repriced Starter to R129 — the map still said 99, so checkout would
        // have charged the wrong amount. Filtering on is_active also means a retired
        // plan (Team) can't be bought just because someone POSTs its name.
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("*")
          .eq("id", planId)
          .eq("is_active", true)
          .maybeSingle();

        if (planError) throw new Error(planError.message);
        if (!plan) {
          return new Response("Plan not found or no longer available", {
            status: 400,
          });
        }

        const price = Number(plan.price_cents) / 100;
        if (!Number.isFinite(price) || price <= 0) {
          return new Response("Plan is not purchasable", { status: 400 });
        }

        // ── Subscribing ─────────────────────────────────────────────────────────
        // Two customers arrive here and they must be treated differently.
        //
        //   EARLY CONVERTER — still inside a live free trial, deciding to stay.
        //     They keep every free day they were promised: PayFast captures the
        //     card now (amount 0.00) and takes the first real payment on the day
        //     the trial would have ended. Their subscription row is left ALONE at
        //     'trialing' — not parked at 'incomplete' — because a customer who
        //     abandons the PayFast page halfway must come back to the trial they
        //     still have, not to a dead account.
        //
        //   EVERYONE ELSE — expired trial, cancelled, or never trialled. Full
        //     price today, first renewal in a month.
        //
        // (The zero-amount tokenisation is the one piece of the old card-required
        // flow that survives, and its unverified-merchant-config risk with it. It
        // now applies only to customers who have already decided to pay, instead
        // of standing in front of every single signup.)
        const now = new Date();

        // The row this business already has, if any. Ordered so the live one wins:
        // this is what decides early-converter vs. everyone-else, and it is also
        // the row we reuse instead of inserting a second one.
        const { data: existingRows, error: existingError } = await supabase
          .from("subscriptions")
          .select("id, status, current_period_start, current_period_end, metadata")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false });

        if (existingError) throw new Error(existingError.message);

        const liveTrial = (existingRows ?? []).find(
          (row) =>
            row.status === "trialing" &&
            row.current_period_end &&
            new Date(row.current_period_end).getTime() > now.getTime(),
        );

        const alreadyActive = (existingRows ?? []).find((row) => row.status === "active");
        if (alreadyActive) {
          return jsonResponse({ error: "already_subscribed", status: "active" }, 409);
        }

        const isTrial = Boolean(liveTrial);

        // Early converter: bill on the day the trial runs out. Otherwise today.
        const firstChargeDate = isTrial
          ? new Date(liveTrial!.current_period_end as string)
          : new Date(now);

        // PayFast rejects a billing_date that isn't in the future, so someone
        // converting on the last day of their trial — the likeliest day of all to
        // convert — would have had their checkout bounced. Push to tomorrow; a
        // few hours of grace is cheaper than a failed payment at the exact moment
        // the customer decided to pay.
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (isTrial && firstChargeDate.getTime() <= tomorrow.getTime()) {
          firstChargeDate.setTime(tomorrow.getTime());
        }

        const billingDateStr = firstChargeDate.toISOString().split("T")[0]; // YYYY-MM-DD

        // A converting trial keeps its existing period end (that IS the first
        // charge date). A fresh paid signup runs a month from today.
        const periodEnd = new Date(isTrial ? firstChargeDate : now);
        if (!isTrial) periodEnd.setMonth(periodEnd.getMonth() + 1);

        // Reuse a row rather than insert. Without this, converting stacked a
        // second subscription on top of the trial every time — the unique index
        // only covers status='active', so nothing downstream complained.
        const reusable = liveTrial ?? (existingRows ?? [])[0] ?? null;

        const subscriptionPatch = {
          user_id: user.id,
          business_id: business.id,
          plan_id: planId,
          // Only a customer with no live trial drops to 'incomplete' — they have
          // no access to lose. See the comment above.
          status: isTrial ? "trialing" : "incomplete",
          // A trial being converted keeps the period start it already had.
          // Moving it to "now" would silently restart the monthly included-credit
          // window that entitlements measures from this field.
          current_period_start:
            (isTrial ? (liveTrial!.current_period_start as string | null) : null) ??
            now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          metadata: {
            ...((reusable?.metadata as Record<string, unknown> | null) ?? {}),
            trial: isTrial,
            trial_ends_at: isTrial ? firstChargeDate.toISOString() : null,
            // Tells the webhook that the imminent R0 ITN is a card capture on a
            // running trial, not a payment to celebrate.
            pending_conversion: isTrial,
            checkout_started_at: now.toISOString(),
          },
        };

        const { error: subscriptionError } = reusable
          ? await supabase.from("subscriptions").update(subscriptionPatch).eq("id", reusable.id)
          : await supabase.from("subscriptions").insert(subscriptionPatch);

        if (subscriptionError) {
          if (subscriptionError.message.includes("violates unique constraint")) {
            return jsonResponse({ error: "already_subscribed" }, 409);
          }
          throw new Error(subscriptionError.message);
        }

        // ── What PayFast should bill every month ────────────────────────────
        // The plan price alone is NOT the answer. A business can buy add-ons
        // during its trial (an extra staff seat is charged pro-rata even then),
        // and while a card was captured up front the webhook raised the
        // recurring amount as each one settled. A card-free trial has no
        // subscription to raise, so those add-ons have been accumulating with
        // nothing on PayFast's side reflecting them — and this checkout is the
        // first and only moment the real monthly figure gets set.
        //
        // Miss it and the customer converts onto a subscription that bills the
        // bare plan price forever while using add-ons they never get charged for.
        let recurringCents = Number(plan.price_cents);

        if (reusable) {
          const { data: attachedAddons, error: attachedError } = await supabase
            .from("subscription_addons")
            .select("quantity, plan_addons!inner(price_cents)")
            .eq("subscription_id", reusable.id)
            .is("remove_at", null); // scheduled for removal = not renewing

          if (attachedError) throw new Error(attachedError.message);

          for (const row of attachedAddons ?? []) {
            const catalog = Array.isArray((row as any).plan_addons)
              ? (row as any).plan_addons[0]
              : (row as any).plan_addons;
            recurringCents +=
              Number(catalog?.price_cents ?? 0) * Number((row as any).quantity ?? 1);
          }
        }

        const recurringAmountStr = (recurringCents / 100).toFixed(2);

        // Build PayFast fields in the EXACT order PayFast expects
        // amount MUST be formatted with exactly 2 decimal places (e.g. "400.00")
        const pf = resolvePayFastCheckout();
        const fields = buildPayFastFields({
          merchantId: pf.merchantId,
          merchantKey: pf.merchantKey,
          returnUrl: `${origin}/billing?payfast=success&subscription_id=${subscriptionId}`,
          cancelUrl: `${origin}/billing?payfast=cancelled&subscription_id=${subscriptionId}`,
          notifyUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
          nameFirst: "Qwickly",
          nameLast: "Subscription",
          emailAddress: "subscriptions@qwickly.co.za",
          mPaymentId: subscriptionId,
          // 0.00 tokenises the card without charging (early converter, still
          // inside a free trial). Otherwise the first month is due now — and at
          // the full total, add-ons included, same as every month after it.
          amount: isTrial ? "0.00" : recurringAmountStr,
          itemName: `Qwickly ${planName} Subscription`,
          // The figure the customer sees on the PayFast page must be the one
          // they will actually be billed — the total, not the bare plan price.
          itemDescription: isTrial
            ? `${planName} plan — free until ${billingDateStr}, then R${recurringAmountStr}/month`
            : `Monthly subscription for ${planName} plan — R${recurringAmountStr}/month`,
          customStr1: "qwickly_subscription",
          customStr2: business.id,
          customStr3: planId,
          subscriptionType: "1",
          billingDate: isTrial ? billingDateStr : "", // first real charge date (end of trial)
          recurringAmount: recurringAmountStr, // plan + every renewing add-on
          frequency: "3", // 3 = Monthly
          cycles: "0", // 0 = Indefinite
        });

        // Generate signature from fields BEFORE adding 'signature' to the object.
        // The passphrase is appended inside generatePayFastSignature — not as a field.
        const signature = generatePayFastSignature(fields, pf.passphrase);

        // Log full debug info to help diagnose any future mismatch
        logSignatureDebugInfo(
          `POST /payfast — planName=${planName} subscriptionId=${subscriptionId} sandbox=${pf.isSandbox}`,
          fields,
          pf.passphrase,
          signature,
        );

        // Return the fields + signature to the frontend.
        // The frontend must submit EXACTLY this object as-is — no reordering,
        // no re-encoding, no type coercion.
        const responseFields = { ...fields, signature };

        console.log(
          "[Subscription Management] Returning PayFast fields:",
          JSON.stringify(responseFields),
        );
        console.log(
          "[Subscription Management] PayFast action URL:",
          pf.processUrl,
          "(sandbox:",
          pf.isSandbox,
          ")",
        );

        return new Response(
          JSON.stringify({
            action: pf.processUrl,
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

      // ─── Add-ons ─────────────────────────────────────────────────────────────
      // Attaching an add-on changes what the customer pays every month, so the
      // price ALWAYS comes from the plan_addons catalog and the monthly total is
      // always recomputed server-side from (plan + every attached add-on). Nothing
      // here trusts a number from the client.
      //
      // Order matters: PayFast is updated FIRST, and the DB only changes if that
      // succeeded. The reverse order can leave a business entitled to a R200 add-on
      // that PayFast never bills for — i.e. we give it away for free.
      // The batch endpoint (/addons/batch) is handled separately below — exclude
      // it here so this single-add-on block's startsWith doesn't swallow it.
      if (
        (method === "POST" || method === "DELETE") &&
        path.startsWith("/subscription-management/addons") &&
        path !== "/subscription-management/addons/batch"
      ) {
        const { data: subscription, error: subError } = await supabase
          .from("subscriptions")
          .select(
            "id, plan_id, status, payfast_token, current_period_start, current_period_end, plans!subscriptions_plan_id_fkey(price_cents)",
          )
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subError) throw new Error(subError.message);
        if (!subscription) {
          return new Response("No active subscription found", { status: 400 });
        }

        /** Recomputes plan + add-ons and pushes the new monthly amount to PayFast. */
        const syncTotalToPayFast = async (): Promise<
          { ok: true; totalCents: number } | { ok: false; message: string }
        > => {
          // Only add-ons that are RENEWING count toward the recurring amount.
          // A row with remove_at set is paid through the current period but must
          // not be billed again, so it's excluded here even though the customer
          // still has access to it.
          const { data: attached, error: attachedError } = await supabase
            .from("subscription_addons")
            .select("quantity, plan_addons!inner(price_cents)")
            .eq("subscription_id", subscription.id)
            .is("remove_at", null);

          if (attachedError) throw new Error(attachedError.message);

          const planRel = subscription.plans as
            | { price_cents: number }
            | { price_cents: number }[]
            | null;
          const planRow = Array.isArray(planRel) ? planRel[0] : planRel;
          const planCents = Number(planRow?.price_cents ?? 0);

          const addonCents = (attached ?? []).reduce((sum: number, row: any) => {
            const catalog = Array.isArray(row.plan_addons)
              ? row.plan_addons[0]
              : row.plan_addons;
            return (
              sum + Number(catalog?.price_cents ?? 0) * Number(row.quantity ?? 1)
            );
          }, 0);

          const totalCents = planCents + addonCents;

          // A card-free trial has no PayFast subscription to update — the
          // customer has not handed over a card yet. That is not a failure:
          // there is simply nothing to sync, and the correct monthly amount is
          // computed from these same rows when they convert (see the checkout
          // handler's recurringAmount). Returning ok here is what lets a
          // trialling business attach and remove add-ons at all.
          if (!subscription.payfast_token) {
            if (subscription.status === "trialing") {
              return { ok: true, totalCents };
            }
            return {
              ok: false,
              message: "No PayFast token on this subscription",
            };
          }

          const updated = await updatePayFastSubscription(
            subscription.payfast_token,
            { amount: totalCents },
          );

          if (!updated) {
            return {
              ok: false,
              message:
                "Could not update the PayFast subscription amount. Nothing was changed — please try again.",
            };
          }

          return { ok: true, totalCents };
        };

        // ── POST /addons — attach, or change quantity ─────────────────────────
        if (method === "POST" && path === "/subscription-management/addons") {
          const body = await req.json();
          const { addonId, quantity } = body;

          if (!addonId || typeof addonId !== "string") {
            return new Response("Add-on ID is required", { status: 400 });
          }

          const qty = Number(quantity ?? 1);
          if (!Number.isInteger(qty) || qty < 1) {
            return new Response("Quantity must be a positive whole number", {
              status: 400,
            });
          }

          const { data: addon, error: addonError } = await supabase
            .from("plan_addons")
            .select("id, name, price_cents, max_quantity, is_active")
            .eq("id", addonId)
            .eq("is_active", true)
            .maybeSingle();

          if (addonError) throw new Error(addonError.message);
          if (!addon) {
            // Covers "doesn't exist" and "coming soon" (is_active = false) alike.
            return new Response(
              "Add-on not found or not available for purchase",
              {
                status: 400,
              },
            );
          }

          if (qty > Number(addon.max_quantity)) {
            return new Response(
              `Maximum quantity for ${addon.name} is ${addon.max_quantity}`,
              { status: 400 },
            );
          }

          // ── Re-attaching something scheduled for removal ────────────────────
          // They already paid for this add-on through the end of the period, so
          // just cancel the removal. Charging again would be double-billing.
          const { data: scheduledForRemoval } = await supabase
            .from("subscription_addons")
            .select("addon_id, quantity, remove_at")
            .eq("subscription_id", subscription.id)
            .eq("addon_id", addon.id)
            .not("remove_at", "is", null)
            .maybeSingle();

          if (
            scheduledForRemoval &&
            Number(scheduledForRemoval.quantity) === qty
          ) {
            const { error: reviveError } = await supabase
              .from("subscription_addons")
              .update({ remove_at: null })
              .eq("subscription_id", subscription.id)
              .eq("addon_id", addon.id);

            if (reviveError) throw new Error(reviveError.message);

            const sync = await syncTotalToPayFast();
            if (!sync.ok) {
              await supabase
                .from("subscription_addons")
                .update({ remove_at: scheduledForRemoval.remove_at })
                .eq("subscription_id", subscription.id)
                .eq("addon_id", addon.id);

              return new Response(
                JSON.stringify({ success: false, message: sync.message }),
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

            return new Response(
              JSON.stringify({
                success: true,
                requiresPayment: false,
                addonId: addon.id,
                quantity: qty,
                monthlyTotalCents: sync.totalCents,
                message:
                  "Cancellation reversed — you had already paid for this period.",
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

          // ── Pro-rata charge for the seats being ADDED ───────────────────────
          // Charge only for the *extra* seats (new qty minus what they already
          // have this period), never for seats already paid for — otherwise
          // raising 1→2 would bill for 2. A row scheduled for removal but still
          // inside its paid period still counts as "already have".
          //
          // Everything in the catalogue is free to try during the trial; it all
          // simply joins the first real charge instead of being billed now.
          //
          // Extra staff used to be the exception, prorated immediately even mid-
          // trial. That stopped making sense the moment the trial stopped asking
          // for a card: we promise "no card required", and then the first owner
          // who adds a second stylist gets bounced to a PayFast page. Charging
          // for a seat inside a period the customer was told is free is the kind
          // of contradiction that generates support mail, not revenue.
          //
          // Tokens remain genuinely pay-as-you-go and are not add-ons at all, so
          // they are unaffected by this list.
          const isTrial = subscription.status === "trialing";
          const TRIAL_FREE_ADDONS = [
            "whatsapp_chatbot",
            "analytics",
            "branded_email",
            "extra_staff",
          ];
          const trialFree = isTrial && TRIAL_FREE_ADDONS.includes(addon.id);

          const { data: currentRow } = await supabase
            .from("subscription_addons")
            .select("quantity, remove_at")
            .eq("subscription_id", subscription.id)
            .eq("addon_id", addon.id)
            .maybeSingle();
          const previousRow = currentRow
            ? {
                subscription_id: subscription.id,
                addon_id: addon.id,
                quantity: Number(currentRow.quantity),
                remove_at: currentRow.remove_at,
              }
            : null;

          const nowMs = Date.now();
          const currentlyEntitledQty =
            currentRow &&
            (!currentRow.remove_at ||
              new Date(currentRow.remove_at).getTime() > nowMs)
              ? Number(currentRow.quantity)
              : 0;
          const deltaQty = qty - currentlyEntitledQty;

          const periodStart = new Date(subscription.current_period_start);
          const periodEnd = new Date(subscription.current_period_end);
          const now = new Date();
          const MS_PER_DAY = 24 * 60 * 60 * 1000;

          const daysInPeriod = Math.max(
            1,
            Math.round(
              (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY,
            ),
          );
          const daysRemaining = Math.max(
            0,
            Math.ceil((periodEnd.getTime() - now.getTime()) / MS_PER_DAY),
          );

          // Only the added seats are charged; a decrease (deltaQty <= 0) is free.
          const prorataCents =
            deltaQty > 0
              ? Math.round(
                  (Number(addon.price_cents) * deltaQty * daysRemaining) /
                    daysInPeriod,
                )
              : 0;

          if (!trialFree && prorataCents > 0) {
            // Do NOT attach yet — the add-on goes live only once the ITN confirms
            // payment. The pending row records the quoted amount because it can't
            // be recomputed later: it depends on the day the quote was made.
            const paymentReference = `qwickly-addon-${Date.now()}`;

            const { error: pendingError } = await supabase
              .from("subscription_addon_purchases")
              .insert({
                subscription_id: subscription.id,
                business_id: business.id,
                addon_id: addon.id,
                quantity: qty,
                amount_cents: prorataCents,
                days_remaining: daysRemaining,
                days_in_period: daysInPeriod,
                payment_ref: paymentReference,
                status: "pending",
              });

            if (pendingError) throw new Error(pendingError.message);

            const pf = resolvePayFastCheckout();
            const fields = buildPayFastFields({
              merchantId: pf.merchantId,
              merchantKey: pf.merchantKey,
              returnUrl: `${body.origin ?? ""}/billing?payfast=addon_success&ref=${paymentReference}`,
              cancelUrl: `${body.origin ?? ""}/billing?payfast=addon_cancelled`,
              notifyUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
              nameFirst: "Qwickly",
              nameLast: "Add-on",
              emailAddress: "billing@qwickly.co.za",
              mPaymentId: paymentReference,
              amount: (prorataCents / 100).toFixed(2),
              itemName: `${addon.name}${deltaQty > 1 ? ` ×${deltaQty}` : ""}`,
              itemDescription:
                `${addon.name} for the rest of this billing period ` +
                `(${daysRemaining} of ${daysInPeriod} days)`,
              customStr1: "qwickly_addon_proration",
              customStr2: business.id,
              customStr3: addon.id,
              // One-time payment: no subscriptionType. The recurring amount is
              // raised separately by the webhook once this settles.
            });

            const signature = generatePayFastSignature(fields, pf.passphrase);

            return new Response(
              JSON.stringify({
                success: true,
                requiresPayment: true,
                action: pf.processUrl,
                paymentReference,
                prorata: {
                  addonId: addon.id,
                  addonName: addon.name,
                  quantity: qty,
                  amountCents: prorataCents,
                  daysRemaining,
                  daysInPeriod,
                },
                fields: { ...fields, signature },
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

          // Free during the trial, a decrease, or nothing left in the period to
          // charge for — attach the new quantity directly with no payment.
          const { error: upsertError } = await supabase
            .from("subscription_addons")
            .upsert(
              {
                subscription_id: subscription.id,
                addon_id: addon.id,
                quantity: qty,
                remove_at: null,
              },
              { onConflict: "subscription_id,addon_id" },
            );

          if (upsertError) throw new Error(upsertError.message);

          const sync = await syncTotalToPayFast();
          if (!sync.ok) {
            // Roll back to exactly what existed before this attempted change.
            // Deleting unconditionally would remove an already-paid add-on if the
            // customer was changing quantity or clearing a scheduled removal.
            if (previousRow) {
              await supabase
                .from("subscription_addons")
                .upsert(previousRow, { onConflict: "subscription_id,addon_id" });
            } else {
              await supabase
                .from("subscription_addons")
                .delete()
                .eq("subscription_id", subscription.id)
                .eq("addon_id", addon.id);
            }

            return new Response(
              JSON.stringify({ success: false, message: sync.message }),
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

          return new Response(
            JSON.stringify({
              success: true,
              requiresPayment: false,
              addonId: addon.id,
              quantity: qty,
              monthlyTotalCents: sync.totalCents,
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

        // ── DELETE /addons/:addonId — schedule removal ────────────────────────
        // The row is NOT deleted. They paid pro-rata through the end of this
        // period, so they keep the feature until then; only the recurring amount
        // drops now. The entitlement resolver stops honouring the row once
        // remove_at passes, so nothing has to sweep it.
        if (method === "DELETE") {
          const addonId = path.split("/").pop();
          if (!addonId || addonId === "addons") {
            return new Response("Add-on ID is required", { status: 400 });
          }

          const { data: existing, error: existingError } = await supabase
            .from("subscription_addons")
            .select("addon_id, quantity, remove_at")
            .eq("subscription_id", subscription.id)
            .eq("addon_id", addonId)
            .maybeSingle();

          if (existingError) throw new Error(existingError.message);
          if (!existing) {
            return new Response("Add-on is not attached to this subscription", {
              status: 400,
            });
          }

          if (existing.remove_at) {
            return new Response("Add-on is already scheduled for removal", {
              status: 400,
            });
          }

          // Access runs to the end of the paid period. On a trial nothing was paid,
          // so it ends when the trial does — which is current_period_end either way.
          const removeAt = subscription.current_period_end;

          const { error: scheduleError } = await supabase
            .from("subscription_addons")
            .update({ remove_at: removeAt })
            .eq("subscription_id", subscription.id)
            .eq("addon_id", addonId);

          if (scheduleError) throw new Error(scheduleError.message);

          const sync = await syncTotalToPayFast();
          if (!sync.ok) {
            // Undo the schedule — PayFast is still billing for it, so it must stay.
            await supabase
              .from("subscription_addons")
              .update({ remove_at: null })
              .eq("subscription_id", subscription.id)
              .eq("addon_id", addonId);

            return new Response(
              JSON.stringify({ success: false, message: sync.message }),
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

          return new Response(
            JSON.stringify({
              success: true,
              addonId,
              removeAt,
              monthlyTotalCents: sync.totalCents,
              message:
                "You'll keep this until the end of your current billing period.",
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
      }

      // ─── POST /subscription-management/addons/batch — attach several at once ──
      // Same economics as the single-add-on path, but several add-ons settle on
      // ONE PayFast payment instead of one checkout each. Everything is priced
      // server-side; nothing here trusts a number from the client.
      //
      // Split of responsibilities:
      //   • Free-now lines (trial-included, a decrease, or nothing left to charge
      //     this period) attach immediately, exactly as the single path does.
      //   • Paid lines become pending rows sharing one payment_ref and are billed
      //     as a single summed PayFast payment; the webhook attaches them and
      //     raises the recurring amount once the ITN settles.
      if (method === "POST" && path === "/subscription-management/addons/batch") {
        const body = await req.json();
        const items = Array.isArray(body?.items) ? body.items : null;
        const origin = typeof body?.origin === "string" ? body.origin : "";

        if (!items || items.length === 0) {
          return new Response("No add-ons selected", { status: 400 });
        }

        const { data: subscription, error: subError } = await supabase
          .from("subscriptions")
          .select(
            "id, plan_id, status, payfast_token, current_period_start, current_period_end, plans!subscriptions_plan_id_fkey(price_cents)",
          )
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subError) throw new Error(subError.message);
        if (!subscription) {
          return new Response("No active subscription found", { status: 400 });
        }

        const isTrial = subscription.status === "trialing";
        // Must match the single-add-on list above — see the note there on why
        // extra_staff joined it.
        const TRIAL_FREE_ADDONS = [
          "whatsapp_chatbot",
          "analytics",
          "branded_email",
          "extra_staff",
        ];

        const periodStart = new Date(subscription.current_period_start);
        const periodEnd = new Date(subscription.current_period_end);
        const now = new Date();
        const nowMs = now.getTime();
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const daysInPeriod = Math.max(
          1,
          Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY),
        );
        const daysRemaining = Math.max(
          0,
          Math.ceil((periodEnd.getTime() - nowMs) / MS_PER_DAY),
        );

        // Resolve and price every line before changing anything, so a bad line
        // rejects the whole batch instead of half-applying it.
        type Line = {
          addonId: string;
          name: string;
          quantity: number;
          priceCents: number;
          prorataCents: number;
          previousRow: { quantity: number; remove_at: string | null } | null;
        };
        const lines: Line[] = [];
        const seen = new Set<string>();

        for (const raw of items) {
          const addonId = typeof raw?.addonId === "string" ? raw.addonId : "";
          const quantity = Number(raw?.quantity ?? 1);

          if (!addonId) return new Response("Add-on ID is required", { status: 400 });
          if (seen.has(addonId)) {
            return new Response(`Duplicate add-on in batch: ${addonId}`, { status: 400 });
          }
          seen.add(addonId);
          if (!Number.isInteger(quantity) || quantity < 1) {
            return new Response("Quantity must be a positive whole number", { status: 400 });
          }

          const { data: addon, error: addonError } = await supabase
            .from("plan_addons")
            .select("id, name, price_cents, max_quantity, is_active")
            .eq("id", addonId)
            .eq("is_active", true)
            .maybeSingle();

          if (addonError) throw new Error(addonError.message);
          if (!addon) {
            return new Response(`Add-on not found or not available: ${addonId}`, { status: 400 });
          }
          if (quantity > Number(addon.max_quantity)) {
            return new Response(
              `Maximum quantity for ${addon.name} is ${addon.max_quantity}`,
              { status: 400 },
            );
          }

          const { data: currentRow } = await supabase
            .from("subscription_addons")
            .select("quantity, remove_at")
            .eq("subscription_id", subscription.id)
            .eq("addon_id", addon.id)
            .maybeSingle();

          const currentlyEntitledQty =
            currentRow &&
            (!currentRow.remove_at || new Date(currentRow.remove_at).getTime() > nowMs)
              ? Number(currentRow.quantity)
              : 0;
          const deltaQty = quantity - currentlyEntitledQty;

          const trialFree = isTrial && TRIAL_FREE_ADDONS.includes(addon.id);
          const prorataCents =
            !trialFree && deltaQty > 0
              ? Math.round(
                  (Number(addon.price_cents) * deltaQty * daysRemaining) / daysInPeriod,
                )
              : 0;

          lines.push({
            addonId: addon.id,
            name: addon.name,
            quantity,
            priceCents: Number(addon.price_cents),
            prorataCents,
            previousRow: currentRow
              ? { quantity: Number(currentRow.quantity), remove_at: currentRow.remove_at }
              : null,
          });
        }

        /** Recompute plan + all renewing add-ons and push the total to PayFast. */
        const syncRecurring = async (): Promise<
          { ok: true; totalCents: number } | { ok: false; message: string }
        > => {
          const { data: attached, error: attachedError } = await supabase
            .from("subscription_addons")
            .select("quantity, plan_addons!inner(price_cents)")
            .eq("subscription_id", subscription.id)
            .is("remove_at", null);
          if (attachedError) throw new Error(attachedError.message);

          const planRel = subscription.plans as
            | { price_cents: number }
            | { price_cents: number }[]
            | null;
          const planRow = Array.isArray(planRel) ? planRel[0] : planRel;
          const planCents = Number(planRow?.price_cents ?? 0);
          const addonCents = (attached ?? []).reduce((sum: number, row: any) => {
            const catalog = Array.isArray(row.plan_addons) ? row.plan_addons[0] : row.plan_addons;
            return sum + Number(catalog?.price_cents ?? 0) * Number(row.quantity ?? 1);
          }, 0);
          const totalCents = planCents + addonCents;

          // See the note on the single-add-on sync above: no token during a
          // card-free trial is the normal state, not an error.
          if (!subscription.payfast_token) {
            if (subscription.status === "trialing") {
              return { ok: true, totalCents };
            }
            return { ok: false, message: "No PayFast token on this subscription" };
          }
          const updated = await updatePayFastSubscription(subscription.payfast_token, {
            amount: totalCents,
          });
          if (!updated) {
            return {
              ok: false,
              message:
                "Could not update the PayFast subscription amount. Nothing was changed — please try again.",
            };
          }
          return { ok: true, totalCents };
        };

        const freeNow = lines.filter((l) => l.prorataCents === 0);
        const paid = lines.filter((l) => l.prorataCents > 0);
        const totalDueCents = paid.reduce((sum, l) => sum + l.prorataCents, 0);

        // Attach the free-now lines immediately (matches the single path). Capture
        // prior state so we can roll back if the PayFast recurring sync fails.
        for (const line of freeNow) {
          const { error: upsertError } = await supabase
            .from("subscription_addons")
            .upsert(
              {
                subscription_id: subscription.id,
                addon_id: line.addonId,
                quantity: line.quantity,
                remove_at: null,
              },
              { onConflict: "subscription_id,addon_id" },
            );
          if (upsertError) throw new Error(upsertError.message);
        }

        if (freeNow.length > 0) {
          const sync = await syncRecurring();
          if (!sync.ok) {
            // Roll each free-now line back to exactly what existed before.
            for (const line of freeNow) {
              if (line.previousRow) {
                await supabase
                  .from("subscription_addons")
                  .upsert(
                    {
                      subscription_id: subscription.id,
                      addon_id: line.addonId,
                      quantity: line.previousRow.quantity,
                      remove_at: line.previousRow.remove_at,
                    },
                    { onConflict: "subscription_id,addon_id" },
                  );
              } else {
                await supabase
                  .from("subscription_addons")
                  .delete()
                  .eq("subscription_id", subscription.id)
                  .eq("addon_id", line.addonId);
              }
            }
            return new Response(
              JSON.stringify({ success: false, message: sync.message }),
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
        }

        // No paid lines → the batch is fully applied already.
        if (paid.length === 0) {
          const { data: attachedNow } = await supabase
            .from("subscription_addons")
            .select("quantity, plan_addons!inner(price_cents)")
            .eq("subscription_id", subscription.id)
            .is("remove_at", null);
          const planRel = subscription.plans as any;
          const planRow = Array.isArray(planRel) ? planRel[0] : planRel;
          const monthlyTotalCents =
            Number(planRow?.price_cents ?? 0) +
            (attachedNow ?? []).reduce((sum: number, row: any) => {
              const catalog = Array.isArray(row.plan_addons) ? row.plan_addons[0] : row.plan_addons;
              return sum + Number(catalog?.price_cents ?? 0) * Number(row.quantity ?? 1);
            }, 0);

          return new Response(
            JSON.stringify({
              success: true,
              requiresPayment: false,
              attached: freeNow.map((l) => l.addonId),
              monthlyTotalCents,
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

        // Paid lines → one shared reference, one pending row per line, one payment.
        const paymentReference = `qwickly-addonbatch-${Date.now()}`;
        const pendingRows = paid.map((l) => ({
          subscription_id: subscription.id,
          business_id: business.id,
          addon_id: l.addonId,
          quantity: l.quantity,
          amount_cents: l.prorataCents,
          days_remaining: daysRemaining,
          days_in_period: daysInPeriod,
          payment_ref: paymentReference,
          status: "pending",
        }));

        const { error: pendingError } = await supabase
          .from("subscription_addon_purchases")
          .insert(pendingRows);
        if (pendingError) throw new Error(pendingError.message);

        const count = paid.length;
        const pf = resolvePayFastCheckout();
        const fields = buildPayFastFields({
          merchantId: pf.merchantId,
          merchantKey: pf.merchantKey,
          returnUrl: `${origin}/billing?payfast=addon_success&ref=${paymentReference}`,
          cancelUrl: `${origin}/billing?payfast=addon_cancelled`,
          notifyUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
          nameFirst: "Qwickly",
          nameLast: "Add-ons",
          emailAddress: "billing@qwickly.co.za",
          mPaymentId: paymentReference,
          amount: (totalDueCents / 100).toFixed(2),
          itemName: `${count} add-on${count > 1 ? "s" : ""}`,
          itemDescription:
            `${count} add-on${count > 1 ? "s" : ""} for the rest of this billing period ` +
            `(${daysRemaining} of ${daysInPeriod} days)`,
          customStr1: "qwickly_addon_batch",
          customStr2: business.id,
          customStr3: paymentReference,
        });
        const signature = generatePayFastSignature(fields, pf.passphrase);

        return new Response(
          JSON.stringify({
            success: true,
            requiresPayment: true,
            action: pf.processUrl,
            paymentReference,
            attachedFree: freeNow.map((l) => l.addonId),
            totalDueCents,
            daysRemaining,
            daysInPeriod,
            lines: paid.map((l) => ({
              addonId: l.addonId,
              addonName: l.name,
              quantity: l.quantity,
              amountCents: l.prorataCents,
            })),
            fields: { ...fields, signature },
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

      // ─── GET /subscription-management/payfast/status — PayFast's own view ─────
      // Diagnostic. Our database records what we INTENDED; this reports what
      // PayFast will actually do — the real amount, next run date, and whether the
      // subscription is ACTIVE or CANCELLED. Use it to confirm a cancel actually
      // took, or that an add-on really did raise the recurring amount.
      if (method === "GET" && path === "/subscription-management/payfast/status") {
        const { data: sub, error: subErr } = await supabase
          .from("subscriptions")
          .select("id, status, payfast_token, plan_id")
          .eq("business_id", business.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subErr) throw new Error(subErr.message);
        if (!sub) return new Response("No subscription found", { status: 404 });
        if (!sub.payfast_token) {
          return new Response(
            JSON.stringify({ error: "No PayFast token on this subscription" }),
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

        const payfast = await fetchPayFastSubscription(sub.payfast_token);

        return new Response(
          JSON.stringify({
            ours: { subscriptionId: sub.id, status: sub.status, planId: sub.plan_id },
            payfast: payfast ?? { error: "Could not reach PayFast — see function logs" },
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

      // ─── GET /subscription-management/addons — catalog + what's attached ──────
      if (method === "GET" && path === "/subscription-management/addons") {
        const { data: catalog, error: catalogError } = await supabase
          .from("plan_addons")
          .select(
            "id, name, price_cents, max_quantity, is_active, public, metadata",
          )
          .eq("public", true)
          .order("price_cents", { ascending: false });

        if (catalogError) throw new Error(catalogError.message);

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let attached: Array<{
          addon_id: string;
          quantity: number;
          remove_at: string | null;
        }> = [];
        if (sub) {
          const { data: rows, error: rowsError } = await supabase
            .from("subscription_addons")
            .select("addon_id, quantity, remove_at")
            .eq("subscription_id", sub.id);

          if (rowsError) throw new Error(rowsError.message);
          attached = (rows ?? []) as Array<{
            addon_id: string;
            quantity: number;
            remove_at: string | null;
          }>;
        }

        return new Response(
          JSON.stringify({ catalog: catalog ?? [], attached }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
          },
        );
      }


      // Here is the NEW POST /subscription-management/credits/purchase for the
      // "Buy a credit bundle" , note thids is a one-time payment (no subscrip): no subscription_type field, so
      // PayFast supposably charges once and never tokenises a card.

      //  price read from credit_bundles here and verified again in the
      // webhook against amount_gross. It is never taken from the client — that is
      // the bug the custom plan builder below still has.

      // No pending-purchase row is written: the ITN carries everything needed
      // (business in custom_str2, bundle in custom_str3, m_payment_id for
      // idempotency), and grant_credits() is keyed on that reference.

      // If being completely honest the 3 lines above are gibberish to me
      //
      if (
        method === "POST" &&
        path === "/subscription-management/credits/purchase"
      ) {
        const body = await req.json();
        const { bundleId, origin } = body;

        if (!bundleId || typeof bundleId !== "string") {
          return new Response("Bundle ID is required", { status: 400 });
        }

        const { data: bundle, error: bundleError } = await supabase
          .from("credit_bundles")
          .select("id, kind, amount, price_cents, is_active")
          .eq("id", bundleId)
          .eq("is_active", true)
          .maybeSingle();

        if (bundleError) throw new Error(bundleError.message);
        if (!bundle) {
          return new Response("Bundle not found or not available", {
            status: 400,
          });
        }

        const price = Number(bundle.price_cents) / 100;
        const paymentReference = `qwickly-credits-${Date.now()}`;
        const unitLabel =
          bundle.kind === "whatsapp_tokens"
            ? "WhatsApp tokens"
            : "marketing emails";

        const pf = resolvePayFastCheckout();
        const fields = buildPayFastFields({
          merchantId: pf.merchantId,
          merchantKey: pf.merchantKey,
          returnUrl: `${origin}/billing?payfast=credits_success&ref=${paymentReference}`,
          cancelUrl: `${origin}/billing?payfast=credits_cancelled`,
          notifyUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-webhook`,
          nameFirst: "Qwickly",
          nameLast: "Credits",
          emailAddress: "billing@qwickly.co.za",
          mPaymentId: paymentReference,
          amount: price.toFixed(2),
          itemName: `${bundle.amount} ${unitLabel}`,
          itemDescription: `Qwickly credit top-up — ${bundle.amount} ${unitLabel}`,
          customStr1: "qwickly_credit_purchase",
          customStr2: business.id,
          customStr3: bundle.id,
          // Deliberately no subscriptionType/billingDate/recurringAmount/frequency/
          // cycles — those are what make PayFast treat a payment as recurring.
        });

        const signature = generatePayFastSignature(fields, pf.passphrase);

        logSignatureDebugInfo(
          `POST /credits/purchase — bundleId=${bundle.id} ref=${paymentReference} sandbox=${pf.isSandbox}`,
          fields,
          pf.passphrase,
          signature,
        );

        return new Response(
          JSON.stringify({
            action: pf.processUrl,
            paymentReference,
            bundle: {
              id: bundle.id,
              kind: bundle.kind,
              amount: bundle.amount,
              priceCents: bundle.price_cents,
            },
            fields: { ...fields, signature },
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

      // ─── Custom plans — RETIRED (2026-07-23) ────────────────────────────────
      // The slider-based custom plan builder is gone from the product (one plan
      // + à-la-carte add-ons, pricing.md 2026-07-15) and its UI entry point is
      // dead-rendered in billing.tsx. Both former endpoints (/payfast/custom and
      // /payfast/update-plan) also trusted a client-supplied finalPrice — a
      // subscriber could set their own recurring amount. Do not resurrect them
      // without computing the price server-side from a catalog.
      if (
        method === "POST" &&
        (path === "/subscription-management/payfast/custom" ||
          path === "/subscription-management/payfast/update-plan")
      ) {
        return new Response(
          JSON.stringify({ error: "Custom plans are no longer available." }),
          {
            status: 410,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
          },
        );
      }

      // ─── GET /subscription-management/usage/monthly-bookings ──────────────────
      if (
        method === "GET" &&
        path === "/subscription-management/usage/monthly-bookings"
      ) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        const { count, error } = await supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("business_id", business.id)
          .gte("start_time", monthStart.toISOString())
          .lt("start_time", monthEnd.toISOString());

        if (error) {
          console.error("[Monthly Bookings] Error counting bookings:", error);
          return new Response("Failed to count bookings", { status: 500 });
        }

        return new Response(JSON.stringify({ count: count || 0 }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── GET /subscription-management/usage/today ───────────────────────────────
      if (method === "GET" && path === "/subscription-management/usage/today") {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

        const { data: usage, error } = await supabase
          .from("usage_tracking")
          .select("*")
          .eq("business_id", business.id)
          .eq("tracking_date", today)
          .maybeSingle();

        if (error) {
          console.error("[Usage Today] Error fetching usage:", error);
          return new Response("Failed to fetch usage", { status: 500 });
        }

        return new Response(JSON.stringify(usage || null), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── GET /subscription-management/invoices ───────────────────────────────
      if (method === "GET" && path === "/subscription-management/invoices") {
        const { data: invoices, error } = await supabase
          .from("invoices")
          .select("*")
          .eq("business_id", business.id)
          .order("payment_date", { ascending: false });

        if (error) {
          console.error("[Invoices] Error fetching invoices:", error);
          return new Response("Failed to fetch invoices", { status: 500 });
        }

        return new Response(JSON.stringify(invoices || []), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── POST /subscription-management/payfast/check-status ──────────────────
      if (
        method === "POST" &&
        path === "/subscription-management/payfast/check-status"
      ) {
        const body = await req.json();
        const { paymentReference } = body;

        if (!paymentReference) {
          return new Response("Missing payment reference", { status: 400 });
        }

        // Check if business already has an active/trialing subscription
        const { data: activeSubscription } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
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
            .select("*, plans!subscriptions_plan_id_fkey(*)")
            .eq("id", activeSubscription.id)
            .single();

          return new Response(JSON.stringify(activeWithPlans), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        // Get incomplete subscription. This endpoint is intentionally read-only:
        // the PayFast webhook is the only path that may activate a subscription
        // because it validates the signed ITN and the PayFast server-to-server
        // notification. The browser return URL is just a convenience poll; trusting
        // it would let a client flip an incomplete row into trialing/active.
        const { data: subscriptions } = await supabase
          .from("subscriptions")
          .select("*, plans!subscriptions_plan_id_fkey(*)")
          .eq("business_id", business.id)
          .eq("status", "incomplete")
          .order("created_at", { ascending: false })
          .limit(1);

        const subscription =
          subscriptions && subscriptions.length > 0 ? subscriptions[0] : null;

        if (!subscription) {
          return new Response("No incomplete subscription found", {
            status: 404,
          });
        }

        return new Response(JSON.stringify({ ...subscription, paymentStatus: "pending" }), {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── PUT /subscription-management — Update subscription ──────────────────
      if (method === "PUT" && path === "/subscription-management") {
        const body = await req.json();
        const { planName, immediate } = body;

        if (!planName || typeof planName !== "string") {
          return new Response("Invalid plan name", { status: 400 });
        }

        const newPlanId = `${planName.toLowerCase()}_monthly`;

        // Validate against the catalog, not a hardcoded map — same reason as the
        // create path above. An inactive plan can't be switched to.
        const { data: targetPlan, error: targetPlanError } = await supabase
          .from("plans")
          .select("id, is_active")
          .eq("id", newPlanId)
          .eq("is_active", true)
          .maybeSingle();

        if (targetPlanError) throw new Error(targetPlanError.message);
        if (!targetPlan) {
          return new Response("Plan not found or no longer available", {
            status: 400,
          });
        }

        // Get current subscription
        const { data: currentSubscription } = await supabase
          .from("subscriptions")
          .select("*, plans!subscriptions_plan_id_fkey(*)")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!currentSubscription) {
          return new Response("No active subscription found", { status: 400 });
        }

        const currentPlan = currentSubscription.plans as {
          id: string;
          price_cents: number;
        };
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
            .select("*, plans!subscriptions_plan_id_fkey(*)")
            .eq("id", currentSubscription.id)
            .single();

          return new Response(
            JSON.stringify({
              ...updatedSubscription,
              message: "Downgrade scheduled for end of billing period",
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
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
          .select("*, plans!subscriptions_plan_id_fkey(*)")
          .eq("id", currentSubscription.id)
          .single();

        return new Response(JSON.stringify(updatedSubscription), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ─── DELETE /subscription-management — Cancel subscription ───────────────
      if (method === "DELETE" && path === "/subscription-management") {
        const { data: currentSubscription } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("business_id", business.id)
          .in("status", ["active", "trialing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!currentSubscription) {
          return new Response("No active subscription found", { status: 400 });
        }

        // Cancel on PayFast if there's a token
        if (currentSubscription.payfast_token) {
          console.log(
            "[Cancel Subscription] Cancelling on PayFast with token:",
            currentSubscription.payfast_token,
          );
          const payFastCancelled = await cancelPayFastSubscription(
            currentSubscription.payfast_token,
          );

          if (!payFastCancelled) {
            console.error(
              "[Cancel Subscription] Failed to cancel on PayFast, but will still cancel locally",
            );
          }
        } else {
          console.log(
            "[Cancel Subscription] No PayFast token found, cancelling locally only",
          );
        }

        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            cancel_at_period_end: true,
            metadata: {
              ...currentSubscription.metadata,
              cancelled_via: "billing_page",
              cancellation_scheduled_at: new Date().toISOString(),
            },
          })
          .eq("id", currentSubscription.id);

        if (updateError) throw new Error(updateError.message);

        const { data: updatedSubscription, error: refetchError } = await supabase
          .from("subscriptions")
          .select("*, plans!subscriptions_plan_id_fkey(*)")
          .eq("id", currentSubscription.id)
          .single();

        if (refetchError) throw new Error(refetchError.message);

        return new Response(JSON.stringify(updatedSubscription), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("[Subscription Management] Error:", err);
      return new Response(err.message || "Internal server error", {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
  });
