import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";
import { getEntitlements } from "./entitlements";

/**
 * Prepaid balances: WhatsApp marketing tokens and marketing email credits.
 * Thin wrapper over the spend_credits()/grant_credits() RPCs in migration 052 —
 * the SQL owns atomicity, this owns pricing and policy.
 *
 * Only MARKETING traffic touches these. Transactional notifications (booking
 * confirmations, reminders, cancellations) are unlimited and must never be
 * charged here — see pricing.md §1.
 */

export type CreditKind = "whatsapp_tokens" | "marketing_emails";

/**
 * Token cost per marketing recipient, by route (pricing.md §9).
 *
 * The asymmetry is not arbitrary: a cold contact goes through the official Meta
 * API, which costs us a real ~R0.80 per conversation. An existing contact is
 * messaged from the business's own connected number, which costs ~nothing. The
 * 5x reflects that, and is what keeps the Meta route above water.
 */
export const TOKENS_PER_COLD_CONTACT = 5;
export const TOKENS_PER_EXISTING_CONTACT = 1;

export type SpendOutcome =
  | {
      ok: true;
      unlimited: boolean;
      spentIncluded: number;
      spentPurchased: number;
      includedUsed: number;
      includedRemaining: number | null;
      purchasedRemaining: number;
    }
  | {
      ok: false;
      error: "insufficient";
      shortfall: number;
      includedRemaining: number;
      purchasedRemaining: number;
    }
  | { ok: false; error: "no_subscription" | "invalid_amount" | "unavailable" };

export type Balance = {
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

function toDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0] ?? null;
}

/** The plan's monthly allowance for a kind, straight off the entitlement. */
function includedLimitFor(
  kind: CreditKind,
  ent: { marketingEmailsPerMonth: number | null; includedTokens: number | null },
): number | null {
  return kind === "marketing_emails" ? ent.marketingEmailsPerMonth : ent.includedTokens;
}

/**
 * Spend from a business's balance. Included allowance is consumed before
 * purchased credits — enforced in SQL, not here.
 *
 * Returns an outcome rather than throwing on insufficient funds: running out of
 * credit is an expected business state, not an error, and callers need to tell
 * the user how short they are.
 *
 * Call this BEFORE dispatching the message. On a false return, don't send.
 */
export async function spendCredits(params: {
  businessId: string;
  kind: CreditKind;
  amount: number;
  reason?: string;
  refId?: string;
}): Promise<SpendOutcome> {
  const { businessId, kind, amount, reason, refId } = params;

  if (!isSupabaseAdminConfigured()) return { ok: false, error: "unavailable" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };

  const ent = await getEntitlements(businessId);
  // No live subscription means no allowance and no right to spend — even if a
  // stale purchased balance is sitting there.
  if (!ent.entitled) return { ok: false, error: "no_subscription" };

  const { data, error } = await getSupabaseAdmin().rpc("spend_credits", {
    p_business_id: businessId,
    p_kind: kind,
    p_amount: amount,
    p_included_limit: includedLimitFor(kind, ent),
    p_period_start: toDateOnly(ent.currentPeriodStart),
    p_reason: reason ?? null,
    p_ref_id: refId ?? null,
  });

  if (error) throw new Error(error.message);

  const result = data as Record<string, unknown>;
  if (result?.["ok"] !== true) {
    if (result?.["error"] === "insufficient") {
      return {
        ok: false,
        error: "insufficient",
        shortfall: Number(result["shortfall"] ?? 0),
        includedRemaining: Number(result["included_remaining"] ?? 0),
        purchasedRemaining: Number(result["purchased_remaining"] ?? 0),
      };
    }
    return { ok: false, error: "invalid_amount" };
  }

  const includedRemaining = result["included_remaining"];
  return {
    ok: true,
    unlimited: result["unlimited"] === true,
    spentIncluded: Number(result["spent_included"] ?? 0),
    spentPurchased: Number(result["spent_purchased"] ?? 0),
    includedUsed: Number(result["included_used"] ?? 0),
    includedRemaining: includedRemaining === null ? null : Number(includedRemaining),
    purchasedRemaining: Number(result["purchased_remaining"] ?? 0),
  };
}

/**
 * Credit a balance. `refId` makes this idempotent — a PayFast ITN that arrives
 * twice credits once.
 */
export async function grantCredits(params: {
  businessId: string;
  kind: CreditKind;
  amount: number;
  source: "purchase" | "refund" | "adjustment";
  reason?: string;
  refId?: string;
}): Promise<{ ok: boolean; duplicate: boolean; purchasedRemaining: number }> {
  const { businessId, kind, amount, source, reason, refId } = params;

  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase not configured");
  }

  const { data, error } = await getSupabaseAdmin().rpc("grant_credits", {
    p_business_id: businessId,
    p_kind: kind,
    p_amount: amount,
    p_source: source,
    p_reason: reason ?? null,
    p_ref_id: refId ?? null,
  });

  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    ok: result["ok"] === true,
    duplicate: result["duplicate"] === true,
    purchasedRemaining: Number(result["purchased_remaining"] ?? 0),
  };
}

/** Current balance for both kinds, with the plan allowance folded in. */
export async function getBalances(businessId: string): Promise<Balance[]> {
  if (!isSupabaseAdminConfigured()) return [];

  const ent = await getEntitlements(businessId);

  const { data, error } = await getSupabaseAdmin()
    .from("credit_balances")
    .select("kind, purchased, included_used, period_start")
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);

  const rows = new Map<string, { purchased: number; included_used: number; period_start: string }>();
  for (const row of (data ?? []) as Array<{
    kind: string;
    purchased: number;
    included_used: number;
    period_start: string;
  }>) {
    rows.set(row.kind, row);
  }

  const kinds: CreditKind[] = ["whatsapp_tokens", "marketing_emails"];
  const periodStart = toDateOnly(ent.currentPeriodStart);

  return kinds.map((kind) => {
    const row = rows.get(kind);
    const includedLimit = includedLimitFor(kind, ent);
    // A balance row from a previous billing period hasn't been rolled over yet
    // (spend_credits does that lazily), so don't report stale usage.
    const stale = Boolean(row && periodStart && row.period_start < periodStart);
    const includedUsed = stale ? 0 : (row?.included_used ?? 0);

    return {
      kind,
      purchased: row?.purchased ?? 0,
      includedUsed,
      includedLimit,
      includedRemaining: includedLimit === null ? null : Math.max(0, includedLimit - includedUsed),
      periodStart: row?.period_start ?? periodStart,
    };
  });
}

/** Bundles for the top-up UI, priced server-side. */
export async function getCreditBundles(kind?: CreditKind) {
  if (!isSupabaseAdminConfigured()) return [];

  let query = getSupabaseAdmin()
    .from("credit_bundles")
    .select("id, kind, amount, price_cents, sort_order")
    .eq("is_active", true);

  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
