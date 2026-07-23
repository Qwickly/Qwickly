import { supabase, supabaseUrl } from "./supabase";

/**
 * Plan add-ons — the à-la-carte half of the pricing model (pricing.md §2-§8).
 *
 * Everything here is server-priced: the edge function reads prices from the
 * plan_addons catalog, recomputes the monthly total from (plan + add-ons), and
 * pushes it to PayFast before touching the database. This module only names an
 * add-on and a quantity; it never sends a price.
 */

export type PlanAddon = {
  id: string;
  name: string;
  price_cents: number;
  max_quantity: number;
  /** false = "coming soon" — shown on the page, not purchasable. */
  is_active: boolean;
  public: boolean;
  metadata: Record<string, unknown>;
};

export type AttachedAddon = {
  addon_id: string;
  quantity: number;
  /** Set when cancelled: still entitled until this moment, not renewing after. */
  remove_at: string | null;
};

export type AddonsResponse = {
  catalog: PlanAddon[];
  attached: AttachedAddon[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function edgeUrl(path: string): string {
  return `${supabaseUrl}/functions/v1/subscription-management${path}`;
}

export async function fetchAddons(): Promise<AddonsResponse> {
  const response = await fetch(edgeUrl("/addons"), {
    headers: await authHeaders(),
  });

  if (!response.ok) throw new Error("Could not load add-ons");
  return (await response.json()) as AddonsResponse;
}

export type ProrataQuote = {
  addonId: string;
  addonName: string;
  quantity: number;
  amountCents: number;
  daysRemaining: number;
  daysInPeriod: number;
};

export type AttachAddonResult = {
  success: boolean;
  /** True when a pro-rata payment is needed before the add-on activates. */
  requiresPayment: boolean;
  monthlyTotalCents?: number;
  message?: string;
  /** Present when requiresPayment — submit these to PayFast. */
  action?: string;
  fields?: Record<string, string>;
  prorata?: ProrataQuote;
};

/**
 * Attach an add-on, or change its quantity.
 *
 * Mid-cycle on a paid plan this returns `requiresPayment: true` plus PayFast
 * fields for the pro-rata amount — the add-on activates only once that payment
 * settles. Otherwise (trialing, or reversing a scheduled removal) it attaches
 * straight away.
 */
export async function attachAddon(
  addonId: string,
  quantity = 1,
): Promise<AttachAddonResult> {
  const response = await fetch(edgeUrl("/addons"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ addonId, quantity, origin: window.location.origin }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Could not add this add-on");
  }

  return payload as AttachAddonResult;
}

export type BatchLineQuote = {
  addonId: string;
  addonName: string;
  quantity: number;
  amountCents: number;
};

export type AttachAddonsBatchResult = {
  success: boolean;
  /** True when a single combined pro-rata payment is needed to activate them. */
  requiresPayment: boolean;
  /** Free-now add-ons attached without payment (trial-included etc.). */
  attachedFree?: string[];
  monthlyTotalCents?: number;
  totalDueCents?: number;
  daysRemaining?: number;
  daysInPeriod?: number;
  lines?: BatchLineQuote[];
  message?: string;
  /** Present when requiresPayment — submit these to PayFast. */
  action?: string;
  fields?: Record<string, string>;
};

/**
 * Attach several add-ons on ONE pro-rata payment.
 *
 * The server prices every line, attaches anything free immediately, and returns
 * PayFast fields for the summed pro-rata amount of the paid lines. Those activate
 * only once that single payment settles.
 */
export async function attachAddonsBatch(
  items: Array<{ addonId: string; quantity: number }>,
): Promise<AttachAddonsBatchResult> {
  const response = await fetch(edgeUrl("/addons/batch"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ items, origin: window.location.origin }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Could not add these add-ons");
  }

  return payload as AttachAddonsBatchResult;
}

export type DetachAddonResult = {
  success: boolean;
  /** When access actually ends — they've paid through this date. */
  removeAt: string;
  monthlyTotalCents: number;
  message?: string;
};

/**
 * Cancel an add-on. It stays active until the end of the current billing period
 * (already paid for) and simply doesn't renew.
 */
export async function detachAddon(addonId: string): Promise<DetachAddonResult> {
  const response = await fetch(edgeUrl(`/addons/${addonId}`), {
    method: "DELETE",
    headers: await authHeaders(),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Could not remove this add-on");
  }

  return payload;
}
