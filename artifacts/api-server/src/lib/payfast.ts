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
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
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

export function getConfiguredPublicOrigin(): string {
  return (
    process.env["WHATSAPP_PAYMENT_ORIGIN"]?.trim() ||
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["APP_URL"]?.trim() ||
    "http://localhost:8080"
  ).replace(/\/$/, "");
}

export function buildPayFastSandboxFields(input: {
  origin: string;
  paymentId: string;
  amount: string;
  itemName: string;
  itemDescription: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string | null;
  businessId: string;
  customSource: string;
}): Record<string, string> {
  const fields: Record<string, string> = {
    merchant_id: PAYFAST_SANDBOX_MERCHANT_ID,
    merchant_key: PAYFAST_SANDBOX_MERCHANT_KEY,
    return_url: `${input.origin}/payments?payfast=test-success&payment_id=${input.paymentId}`,
    cancel_url: `${input.origin}/payments?payfast=test-cancelled&payment_id=${input.paymentId}`,
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
    signature: createPayFastSignature(fields),
  };
}

export function buildPayFastStartUrl(origin: string, paymentId: string): string {
  return `${origin}/api/payments/payfast-sandbox/${encodeURIComponent(paymentId)}/start`;
}
