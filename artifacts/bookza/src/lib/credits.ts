import { buildApiUrl } from "@workspace/api-client-react";
import { supabase } from "./supabase";

/**
 * Prepaid balances: WhatsApp marketing tokens and marketing email credits.
 * Mirrors artifacts/api-server/src/lib/credits.ts — the server is authoritative,
 * this is for rendering balances and starting a top-up.
 *
 * Only MARKETING traffic uses these. Transactional booking notifications are
 * unlimited and never charged (pricing.md §1).
 */

export type CreditKind = "whatsapp_tokens" | "marketing_emails";

export type CreditBalance = {
  kind: CreditKind;
  /** Bought in bundles. Doesn't expire while subscribed; forfeited on cancellation. */
  purchased: number;
  /** Consumed against this billing period's allowance. */
  includedUsed: number;
  /** The plan's monthly allowance. `null` = unlimited. */
  includedLimit: number | null;
  /** `null` when unlimited. */
  includedRemaining: number | null;
  periodStart: string | null;
};

export type CreditBalancesResponse = {
  balances: CreditBalance[];
  rates: { tokensPerExistingContact: number; tokensPerColdContact: number };
};

export type CreditBundle = {
  id: string;
  kind: CreditKind;
  amount: number;
  price_cents: number;
  sort_order: number;
};

export async function fetchCreditBalances(): Promise<CreditBalancesResponse> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(buildApiUrl("/api/credits/balance"), {
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) throw new Error("Could not load credit balances");
  return (await response.json()) as CreditBalancesResponse;
}

export async function fetchCreditBundles(kind?: CreditKind): Promise<CreditBundle[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const query = kind ? `?kind=${kind}` : "";

  const response = await fetch(buildApiUrl(`/api/credits/bundles${query}`), {
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) throw new Error("Could not load credit bundles");
  const payload = (await response.json()) as { bundles: CreditBundle[] };
  return payload.bundles ?? [];
}

/**
 * Start a credit top-up. Returns PayFast form fields to submit — the price is
 * decided server-side from the bundle catalog, so nothing here is trusted.
 *
 * Credits land via the PayFast ITN, not on return to the site, so the balance
 * updates a few seconds after the customer gets back.
 */
export async function purchaseCreditBundle(
  bundleId: string,
): Promise<{ action: string; paymentReference: string; fields: Record<string, string> }> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const response = await fetch(`${supabaseUrl}/functions/v1/subscription-management/credits/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ bundleId, origin: window.location.origin }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Could not start credit purchase");
  }

  return await response.json();
}

/**
 * Submit PayFast's signed fields as a real form POST.
 *
 * It must be a form navigation, not fetch(): PayFast redirects the customer to a
 * payment page, and the field order the server signed must survive untouched.
 */
export function submitPayFastForm(action: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

export function formatCredits(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString("en-ZA");
}

export function formatRand(cents: number): string {
  return `R${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;
}
