import { createHash } from "node:crypto";
import type { Request } from "express";

export const PAYFAST_SANDBOX_URL =
  process.env["PAYFAST_SANDBOX_URL"] ?? "https://sandbox.payfast.co.za/eng/process";
export const PAYFAST_SANDBOX_MERCHANT_ID =
  process.env["PAYFAST_SANDBOX_MERCHANT_ID"] ?? "10036200";
export const PAYFAST_SANDBOX_MERCHANT_KEY =
  process.env["PAYFAST_SANDBOX_MERCHANT_KEY"] ?? "ztgkjo0djf02j";
export const PAYFAST_SANDBOX_PASSPHRASE =
  process.env["PAYFAST_SANDBOX_PASSPHRASE"] ?? "uber20206torbeN";

export function encodePayFastValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function createPayFastSignature(
  fields: Record<string, string>,
  passphrase = PAYFAST_SANDBOX_PASSPHRASE,
): string {
  const parameterString = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return createHash("md5").update(parameterString).digest("hex");
}

export function readPayFastString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizePayFastFields(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key !== "signature")
      .map(([key, value]) => [key, readPayFastString(value)]),
  );
}

export function getRequestOrigin(req: Request): string {
  const requestedOrigin = typeof req.body?.origin === "string" ? req.body.origin : "";
  if (/^https?:\/\/[^/]+$/i.test(requestedOrigin)) return requestedOrigin;

  const fallbackProtocol = req.get("x-forwarded-proto") ?? req.protocol;
  return `${fallbackProtocol}://${req.get("host")}`;
}

/**
 * This API's own public host, for anything PayFast has to call server-to-server.
 *
 * Deliberately never derived from the request body: `getRequestOrigin` honours a
 * client-supplied `origin`, which is right for deciding where to send the
 * customer's browser back to and wrong for a notify_url — a caller who could
 * set it would redirect the notification and leave every payment stuck pending.
 *
 * `req.get("host")` is the fallback rather than the first choice because behind
 * a proxy it can be an internal hostname PayFast cannot resolve.
 */
export function getConfiguredApiOrigin(req: Request): string {
  const configured = (
    process.env["PUBLIC_API_URL"]?.trim() ||
    process.env["API_PUBLIC_URL"]?.trim() ||
    ""
  ).replace(/\/$/, "");
  if (/^https?:\/\/[^/]+$/i.test(configured)) return configured;

  const protocol = req.get("x-forwarded-proto") ?? req.protocol;
  return `${protocol}://${req.get("host")}`;
}

/**
 * This API's public host, for callers with no request to hand — the WhatsApp
 * pipeline builds payment links from a background job. Same value as
 * {@link getConfiguredApiOrigin}, minus the request fallback.
 */
export function getConfiguredPublicOrigin(): string {
  return (
    process.env["PUBLIC_API_URL"]?.trim() ||
    process.env["API_PUBLIC_URL"]?.trim() ||
    process.env["WHATSAPP_PAYMENT_ORIGIN"]?.trim() ||
    "http://localhost:8080"
  ).replace(/\/$/, "");
}

/**
 * Where the customer-facing app is served from.
 *
 * A separate deployment to this API, and the distinction matters every time a
 * person's browser has to land somewhere: return URLs, cancel URLs, anything
 * shared in a message. Pointing those at the API host lands them on Express's
 * 404 page.
 */
export function getConfiguredAppOrigin(): string {
  return (
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["APP_URL"]?.trim() ||
    "http://localhost:23168"
  ).replace(/\/$/, "");
}

export function buildPayFastSandboxFields(input: {
  /**
   * Where PayFast's own server-to-server notification goes — the API's public
   * host. Distinct from `appOrigin` below, and the two are genuinely different
   * deployments.
   */
  origin: string;
  /**
   * Where the CUSTOMER's browser is sent back to, when the caller has not
   * supplied explicit return/cancel URLs. Defaults to `origin` for the
   * dashboard's own sandbox tester, which is served from the API host.
   */
  appOrigin?: string;
  paymentId: string;
  amount: string;
  itemName: string;
  itemDescription: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string | null;
  businessId: string;
  customSource: string;
  /**
   * Overrides for a business's own connected PayFast merchant. Omit to use
   * Qwickly's shared sandbox test merchant (the historical/default behavior —
   * the "PayFast Sandbox Tester" button and unconnected businesses rely on
   * this default staying unchanged).
   */
  merchantId?: string;
  merchantKey?: string;
  passphrase?: string;
  /** Return/cancel URLs default to the dashboard's sandbox-tester return page. */
  returnUrl?: string;
  cancelUrl?: string;
}): Record<string, string> {
  const fields: Record<string, string> = {
    merchant_id: input.merchantId ?? PAYFAST_SANDBOX_MERCHANT_ID,
    merchant_key: input.merchantKey ?? PAYFAST_SANDBOX_MERCHANT_KEY,
    return_url:
      input.returnUrl ??
      `${input.appOrigin ?? input.origin}/payments?payfast=test-success&payment_id=${input.paymentId}`,
    cancel_url:
      input.cancelUrl ??
      `${input.appOrigin ?? input.origin}/payments?payfast=test-cancelled&payment_id=${input.paymentId}`,
    notify_url: `${input.origin}/api/payments/payfast-sandbox/notify`,
    name_first: input.customerFirstName || "Bookza",
    name_last: input.customerLastName || "Client",
    email_address: input.customerEmail || "test@bookza.co.za",
    m_payment_id: input.paymentId,
    amount: input.amount,
    item_name: input.itemName,
    item_description: input.itemDescription,
    custom_str1: input.customSource,
    custom_str2: input.businessId,
  };

  return {
    ...fields,
    signature: createPayFastSignature(fields, input.passphrase ?? PAYFAST_SANDBOX_PASSPHRASE),
  };
}

export function buildPayFastStartUrl(origin: string, paymentId: string): string {
  return `${origin}/api/payments/payfast-sandbox/${encodeURIComponent(paymentId)}/start`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The server-to-server API
//
// A different signature rule to the checkout/ITN one above, and the difference
// is the thing that catches people out: here the passphrase is one of the
// fields SORTED ALPHABETICALLY with the rest, rather than appended at the end.
// The same mistake cost the subscription edge function a run of 401s — see the
// note on generatePayFastApiSignature in supabase/functions/subscription-
// management/index.ts, which this mirrors.
// ─────────────────────────────────────────────────────────────────────────────

/** PayFast wants local time, ISO-8601 shaped, with no timezone suffix. */
export function payFastApiTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

export function createPayFastApiSignature(
  fields: Record<string, string>,
  passphrase: string,
): string {
  const signable: Record<string, string> = { ...fields };
  delete signable["signature"];
  // Content-Type is an HTTP transport header, not a PayFast signed variable.
  // Including it injects a pair PayFast never has on its side.
  delete signable["Content-Type"];
  delete signable["content-type"];
  if (passphrase) signable["passphrase"] = passphrase;

  const parameterString = Object.keys(signable)
    .sort()
    .map((key) => `${key}=${encodePayFastValue(signable[key] ?? "")}`)
    .join("&");

  return createHash("md5").update(parameterString).digest("hex");
}

export type PayFastCredentialCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Asks PayFast whether a set of credentials is real, before we record them as
 * connected.
 *
 * `connected` used to be written `true` on save with nothing behind it, so a
 * mistyped merchant key read as Connected in Settings, looked healthy on the
 * Payments page, and only failed for the first client who tried to pay — at
 * which point nobody on the business's side found out.
 *
 * `/ping` is the cheapest authenticated call PayFast exposes: it takes the same
 * signed headers as the rest of the API and returns 200 for a valid merchant.
 * A network failure is NOT reported as invalid credentials — we cannot tell the
 * difference between "these are wrong" and "PayFast is unreachable", and
 * refusing a correct merchant id because of a blip is the worse error.
 */
export async function verifyPayFastCredentials(input: {
  merchantId: string;
  passphrase: string;
  mode: "sandbox" | "live";
}): Promise<PayFastCredentialCheck> {
  const headers: Record<string, string> = {
    "merchant-id": input.merchantId,
    version: "v1",
    timestamp: payFastApiTimestamp(),
  };
  headers["signature"] = createPayFastApiSignature(headers, input.passphrase);

  const url = `https://api.payfast.co.za/ping?testing=${input.mode === "sandbox"}`;

  try {
    const response = await fetch(url, { headers });
    if (response.ok) return { ok: true };

    if (response.status === 401 || response.status === 400) {
      return {
        ok: false,
        reason:
          "PayFast rejected these details. Check the Merchant ID, Merchant Key and passphrase, and that the mode matches the account.",
      };
    }
    return { ok: false, reason: `PayFast returned an unexpected response (${response.status}).` };
  } catch {
    // Unreachable — see the note above. Treated as inconclusive by the caller.
    return { ok: false, reason: "UNREACHABLE" };
  }
}
