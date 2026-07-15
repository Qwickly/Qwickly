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
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
};

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
