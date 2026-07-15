import { md5 } from "https://esm.sh/js-md5@0.8.3";

/**
 * PayFast server-to-server API helpers (update / cancel a subscription).
 *
 * ⚠️ This is the API signature algorithm — fields sorted ALPHABETICALLY. It is
 * NOT the HTML form checkout signature, which uses PayFast's own defined field
 * order. Mixing them up is the classic cause of signature mismatches.
 *
 * ── The bug this file exists to fix ────────────────────────────────────────
 * Both callers used to build ONE object holding the PayFast header variables AND
 * `Content-Type: application/json`, then signed the whole thing. PayFast's spec
 * says the signature covers "the alphabetised submitted header and body
 * variables" — meaning ITS variables (merchant-id, version, timestamp), not HTTP
 * transport headers. Signing Content-Type injected an extra
 * `Content-Type=application%2Fjson` pair into the hash, so the signature could
 * never match and every update/cancel failed with "Generated signature does not
 * match submitted signature".
 *
 * The fix is the split below: `signedVars` is what gets hashed, and Content-Type
 * is added only to the outgoing HTTP request. Keep them separate.
 */

/** Fields PayFast signs. HTTP transport headers must never appear in here. */
type SignedVars = Record<string, string>;

function payfastConfig() {
  const isSandbox = Deno.env.get("PAYFAST_MODE") === "sandbox";
  return {
    isSandbox,
    merchantId: isSandbox
      ? (Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID") || "10036200")
      : (Deno.env.get("PAYFAST_PRODUCTION_MERCHANT_ID") || "34837169"),
    passphrase: isSandbox
      ? (Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN")
      : (Deno.env.get("PAYFAST_PRODUCTION_PASSPHRASE") || "Qwickly2026DT"),
  };
}

/**
 * MD5 of the alphabetised PayFast header + body variables plus the passphrase.
 * Lowercase output, standard URL encoding (spaces → %20, NOT "+" — that's the
 * form-checkout rule).
 */
export function generatePayFastApiSignature(
  signedVars: SignedVars,
  body: Record<string, string> = {},
  passphrase: string,
): string {
  const allFields: Record<string, string> = { ...signedVars, ...body };
  delete allFields.signature;

  const pairs: string[] = [];
  for (const key of Object.keys(allFields).sort()) {
    const value = allFields[key];
    if (value === "" || value === null || value === undefined) continue;
    pairs.push(`${key}=${encodeURIComponent(value)}`);
  }

  let parameterString = pairs.join("&");
  if (passphrase && passphrase.length > 0) {
    parameterString += `&passphrase=${encodeURIComponent(passphrase)}`;
  }

  console.log("[PayFast API Signature] Parameter string:", parameterString);
  return md5(parameterString);
}

/** ISO-8601 without timezone: YYYY-MM-DDTHH:MM:SS */
export function generateApiTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/** Builds the signed vars + the real HTTP headers, keeping the two distinct. */
function buildApiHeaders(body: Record<string, string>): {
  httpHeaders: Record<string, string>;
} {
  const { merchantId, passphrase } = payfastConfig();

  // Only these three are signed.
  const signedVars: SignedVars = {
    "merchant-id": merchantId,
    version: "v1",
    timestamp: generateApiTimestamp(),
  };

  const signature = generatePayFastApiSignature(signedVars, body, passphrase);

  // Content-Type is added AFTER signing — it is not a PayFast variable.
  return {
    httpHeaders: {
      ...signedVars,
      signature,
      "Content-Type": "application/json",
    },
  };
}

/**
 * Change a live PayFast subscription's recurring amount (in cents).
 * Returns false rather than throwing so callers can decide how to recover.
 */
export async function updatePayFastSubscriptionAmount(
  payfastToken: string,
  amountCents: number,
): Promise<boolean> {
  const { isSandbox } = payfastConfig();
  const body: Record<string, string> = { amount: String(amountCents) };
  const { httpHeaders } = buildApiHeaders(body);

  // `testing` must track the mode. This was hardcoded to true, which in
  // production makes every call a no-op that still returns success.
  const url =
    `https://api.payfast.co.za/subscriptions/${payfastToken}/update?testing=${isSandbox}`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: httpHeaders,
      body: JSON.stringify(body),
    });

    const text = await response.text().catch(() => "");

    if (!response.ok) {
      console.error("[PayFast API] Failed to update subscription amount", {
        status: response.status,
        response: text,
      });
      return false;
    }

    console.log("[PayFast API] Subscription amount updated", { amountCents, response: text });
    return true;
  } catch (error) {
    console.error("[PayFast API] Update request threw", error);
    return false;
  }
}

/**
 * Ask PayFast what it thinks the subscription looks like: amount, next run date,
 * and status_text (ACTIVE / CANCELLED / PAUSED).
 *
 * This is the only honest way to answer "did the cancel actually work?" or "is
 * PayFast really going to bill R329 next month?" — our own database only records
 * what we *intended*. Returns null on failure rather than throwing.
 */
export async function fetchPayFastSubscription(
  payfastToken: string,
): Promise<Record<string, unknown> | null> {
  const { isSandbox } = payfastConfig();
  const { httpHeaders } = buildApiHeaders({});

  const url =
    `https://api.payfast.co.za/subscriptions/${payfastToken}/fetch?testing=${isSandbox}`;

  try {
    const response = await fetch(url, { method: "GET", headers: httpHeaders });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      console.error("[PayFast API] Fetch failed", { status: response.status, response: text });
      return null;
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error("[PayFast API] Fetch returned non-JSON", { response: text });
      return null;
    }
  } catch (error) {
    console.error("[PayFast API] Fetch request threw", error);
    return null;
  }
}

/** Cancel a live PayFast subscription so it stops billing. */
export async function cancelPayFastSubscriptionApi(payfastToken: string): Promise<boolean> {
  const { isSandbox } = payfastConfig();
  // Cancel takes no body, but the (empty) body still participates in the signature.
  const body: Record<string, string> = {};
  const { httpHeaders } = buildApiHeaders(body);

  const url =
    `https://api.payfast.co.za/subscriptions/${payfastToken}/cancel?testing=${isSandbox}`;

  try {
    const response = await fetch(url, { method: "PUT", headers: httpHeaders });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      console.error("[PayFast API] Failed to cancel subscription", {
        status: response.status,
        response: text,
      });
      return false;
    }

    console.log("[PayFast API] Subscription cancelled", { response: text });
    return true;
  } catch (error) {
    console.error("[PayFast API] Cancel request threw", error);
    return false;
  }
}
