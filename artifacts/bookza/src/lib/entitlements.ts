import { buildApiUrl } from "@workspace/api-client-react";
import { supabase } from "./supabase";

/**
 * Client mirror of the server's entitlement resolver
 * (artifacts/api-server/src/lib/entitlements.ts). The server is authoritative —
 * this is for showing and hiding UI, never for deciding whether something is
 * allowed. Anything that costs money must be checked server-side too.
 */

export const ADDON_IDS = [
  "whatsapp_chatbot",
  "analytics",
  "branded_email",
  "extra_staff",
  "ai_assistant",
  "custom_domain",
] as const;

export type AddonId = (typeof ADDON_IDS)[number];

export type EntitlementReason =
  | "active"
  | "trialing"
  | "trial_expired"
  | "past_due_grace"
  | "past_due_expired"
  | "no_subscription"
  | "inactive";

export type Entitlements = {
  businessId: string;
  subscriptionId: string | null;
  planId: string | null;
  planName: string | null;
  status: string | null;
  entitled: boolean;
  reason: EntitlementReason;
  /** `null` means unlimited. */
  seats: { staff: number | null; logins: number | null };
  dashboard: "basic" | "full";
  marketingEmailsPerMonth: number | null;
  includedTokens: number | null;
  whatsappSession: boolean;
  grants: Record<AddonId, boolean>;
  addonQuantities: Record<AddonId, number>;
  /** Start of the current billing (or trial) period — used to pro-rate add-ons. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** While a trial is live, the date it runs out. Nothing is charged on it. */
  trialEndsAt: string | null;
  /** True once this business has used its one free trial — no second trial. */
  trialUsed: boolean;
};

/**
 * Clear the server's 60s entitlement cache for this business.
 *
 * Call after anything that changes entitlements WITHOUT going through the API
 * server — i.e. the add-on and subscription endpoints on the edge function,
 * which write to Supabase directly and cannot reach the API server's memory.
 * Failure is deliberately swallowed: the cache expires on its own within the
 * minute, so a refetch that is merely slow to reflect reality is not worth
 * failing a successful purchase over.
 */
export async function invalidateServerEntitlements(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    await fetch(buildApiUrl("/api/entitlements/invalidate"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  } catch {
    // See above — the cache is self-healing.
  }
}

export async function fetchEntitlements(): Promise<Entitlements> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(buildApiUrl("/api/entitlements"), {
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | Entitlements
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : "Could not load entitlements",
    );
  }

  return payload as Entitlements;
}

/** True when the seat limit still has room. `null` limits are unlimited. */
export function hasSeatAvailable(limit: number | null, used: number): boolean {
  return limit === null || used < limit;
}

export function formatLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : String(limit);
}
