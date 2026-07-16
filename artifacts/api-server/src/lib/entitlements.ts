import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";

/**
 * Single source of truth for "what is this business allowed to do?".
 *
 * Resolution order (see pricing.md §12 and migration 051):
 *   plan.metadata.grants[x] === true   →  granted by the plan itself
 *   OR a subscription_addons row for x →  granted because they bought it
 *
 * The `grants` object is what lets dev_full_access hand out everything without
 * fabricating add-on purchases against internal accounts.
 *
 * Nothing in this module enforces anything — it only reports. Callers decide.
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

/**
 * Add-on features unlocked FREE during the 14-day trial, so a business can try
 * the things we most want them to buy. Decided 2026-07-16:
 *   - chatbot, analytics, branded email → included (try before you buy)
 *   - WhatsApp marketing tokens        → NOT included (no free Meta sends; the
 *     100 marketing emails are still free via the plan's monthly allowance)
 *   - ai_assistant, custom_domain       → excluded (not launched)
 * When the trial ends, these lock again unless the business has actually bought
 * them — which is exactly what makes the trial convert.
 */
const TRIAL_INCLUDED_GRANTS: readonly AddonId[] = [
  "whatsapp_chatbot",
  "analytics",
  "branded_email",
];

/**
 * How long a past_due subscription keeps working after its period ends. A failed
 * PayFast charge should leave a short recovery window for retry/card fixes, but
 * not a full extra week of access.
 */
export const PAST_DUE_GRACE_DAYS = 1;

const CACHE_TTL_MS = 60_000;

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
  /** True when the subscription currently grants anything at all. */
  entitled: boolean;
  reason: EntitlementReason;
  /** Seat limits. `null` means unlimited. Already includes purchased add-on seats. */
  seats: { staff: number | null; logins: number | null };
  dashboard: "basic" | "full";
  marketingEmailsPerMonth: number | null;
  includedTokens: number | null;
  whatsappSession: boolean;
  /** Effective grants: plan grant OR purchased add-on. */
  grants: Record<AddonId, boolean>;
  /** Raw purchased quantity per add-on (0 when not bought). */
  addonQuantities: Record<AddonId, number>;
  /** Start of the current billing period. Drives the monthly included-credit reset. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  /** Set while status is 'trialing' — the date of the first real charge. */
  trialEndsAt: string | null;
};

type PlanRow = {
  id: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
};

type SubscriptionRow = {
  id: string;
  plan_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  metadata: Record<string, unknown> | null;
  plans: PlanRow | PlanRow[] | null;
};

const cache = new Map<string, { expiresAt: number; value: Entitlements }>();

/**
 * Drop a business's cached entitlements. Call after any subscription or add-on
 * change so the next read reflects it immediately rather than up to 60s later.
 */
export function invalidateEntitlements(businessId: string): void {
  cache.delete(businessId);
}

export function invalidateAllEntitlements(): void {
  cache.clear();
}

function emptyGrants(): Record<AddonId, boolean> {
  return Object.fromEntries(ADDON_IDS.map((id) => [id, false])) as Record<AddonId, boolean>;
}

function emptyQuantities(): Record<AddonId, number> {
  return Object.fromEntries(ADDON_IDS.map((id) => [id, 0])) as Record<AddonId, number>;
}

/**
 * Read a seat/allowance limit out of plan metadata.
 *
 * Convention (migration 051): the key is present with an explicit JSON `null`
 * to mean unlimited. A MISSING key is treated as zero — fail closed, so a
 * malformed plan can't accidentally hand out unlimited seats.
 */
function readLimit(meta: Record<string, unknown>, key: string): number | null {
  if (!(key in meta)) return 0;
  const raw = meta[key];
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readGrants(meta: Record<string, unknown>): Record<AddonId, boolean> {
  const raw = (meta["grants"] ?? {}) as Record<string, unknown>;
  const grants = emptyGrants();
  for (const id of ADDON_IDS) {
    // Only a literal `true` grants — anything else fails closed.
    grants[id] = raw[id] === true;
  }
  return grants;
}

function notEntitled(
  businessId: string,
  reason: EntitlementReason,
  sub: SubscriptionRow | null,
  plan: PlanRow | null,
): Entitlements {
  return {
    businessId,
    subscriptionId: sub?.id ?? null,
    planId: sub?.plan_id ?? null,
    planName: plan?.name ?? null,
    status: sub?.status ?? null,
    entitled: false,
    reason,
    seats: { staff: 0, logins: 0 },
    dashboard: "basic",
    marketingEmailsPerMonth: 0,
    includedTokens: 0,
    whatsappSession: false,
    grants: emptyGrants(),
    addonQuantities: emptyQuantities(),
    currentPeriodStart: sub?.current_period_start ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    trialEndsAt: null,
  };
}

/** Unwrap the PostgREST embedded relation, which types as object-or-array. */
function firstPlan(plans: PlanRow | PlanRow[] | null): PlanRow | null {
  if (!plans) return null;
  return Array.isArray(plans) ? (plans[0] ?? null) : plans;
}

/**
 * Pick the subscription that decides entitlements when a business somehow has
 * more than one: prefer a live one, then a recoverable one, else most recent.
 */
function pickSubscription(rows: SubscriptionRow[]): SubscriptionRow | null {
  if (rows.length === 0) return null;
  const rank = (status: string): number => {
    if (status === "active") return 0;
    if (status === "trialing") return 1;
    if (status === "past_due") return 2;
    return 3;
  };
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status))[0] ?? null;
}

function isWithinPastDueGrace(sub: SubscriptionRow): boolean {
  if (!sub.current_period_end) return false;
  const end = new Date(sub.current_period_end).getTime();
  if (!Number.isFinite(end)) return false;
  return Date.now() < end + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

export async function getEntitlements(businessId: string): Promise<Entitlements> {
  const cached = cache.get(businessId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await resolveEntitlements(businessId);
  cache.set(businessId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function resolveEntitlements(businessId: string): Promise<Entitlements> {
  if (!isSupabaseAdminConfigured()) {
    return notEntitled(businessId, "no_subscription", null, null);
  }

  const admin = getSupabaseAdmin();

  const { data: subRows, error: subError } = await admin
    .from("subscriptions")
    .select(
      "id, plan_id, status, current_period_start, current_period_end, metadata, plans!subscriptions_plan_id_fkey(id, name, metadata)",
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (subError) throw new Error(subError.message);

  const sub = pickSubscription((subRows ?? []) as SubscriptionRow[]);
  if (!sub) return notEntitled(businessId, "no_subscription", null, null);

  const plan = firstPlan(sub.plans);
  if (!plan) return notEntitled(businessId, "inactive", sub, null);

  // Decide whether this subscription grants anything before doing more work.
  let reason: EntitlementReason;
  if (sub.status === "active") reason = "active";
  else if (sub.status === "trialing") reason = "trialing";
  else if (sub.status === "past_due") {
    reason = isWithinPastDueGrace(sub) ? "past_due_grace" : "past_due_expired";
  } else reason = "inactive";

  if (reason === "past_due_expired" || reason === "inactive") {
    return notEntitled(businessId, reason, sub, plan);
  }

  const { data: addonRows, error: addonError } = await admin
    .from("subscription_addons")
    .select("addon_id, quantity, remove_at, plan_addons!inner(id, metadata)")
    .eq("subscription_id", sub.id);

  if (addonError) throw new Error(addonError.message);

  const addonQuantities = emptyQuantities();
  let extraStaffSeats = 0;
  const now = Date.now();

  for (const row of (addonRows ?? []) as Array<{
    addon_id: string;
    quantity: number | null;
    remove_at: string | null;
    plan_addons: { id: string; metadata: Record<string, unknown> | null } | Array<{ id: string; metadata: Record<string, unknown> | null }> | null;
  }>) {
    if (!(ADDON_IDS as readonly string[]).includes(row.addon_id)) continue;

    // Cancelled add-ons stay entitled until the period they were paid for ends
    // (migration 055). Past that, the row lingers but grants nothing — which is
    // why this is checked here rather than by a sweeper job.
    if (row.remove_at && new Date(row.remove_at).getTime() <= now) continue;

    const id = row.addon_id as AddonId;
    const qty = Math.max(0, Number(row.quantity ?? 0));
    addonQuantities[id] = qty;

    // Seat-granting add-ons declare what they grant in their catalog metadata
    // ({"grantsSeat":"staff","seatsPerUnit":1}) rather than being hardcoded here,
    // so a future logins-granting add-on is a seed row, not a code change.
    const catalog = Array.isArray(row.plan_addons) ? row.plan_addons[0] : row.plan_addons;
    const meta = (catalog?.metadata ?? {}) as Record<string, unknown>;
    if (meta["grantsSeat"] === "staff") {
      const per = Number(meta["seatsPerUnit"] ?? 1);
      extraStaffSeats += qty * (Number.isFinite(per) ? per : 1);
    }
  }

  const planMeta = (plan.metadata ?? {}) as Record<string, unknown>;
  const planGrants = readGrants(planMeta);

  // A feature is granted if the plan grants it, OR it was bought, OR this is a
  // trial and the feature is trial-included. Token/email allowances are NOT
  // touched here — the trial keeps the plan's includedTokens (0 for Starter) and
  // marketingEmailsPerMonth (100), so no free Meta sends but free emails stay.
  const isTrialing = reason === "trialing";
  const grants = emptyGrants();
  for (const id of ADDON_IDS) {
    grants[id] =
      planGrants[id] ||
      addonQuantities[id] > 0 ||
      (isTrialing && TRIAL_INCLUDED_GRANTS.includes(id));
  }

  const baseStaff = readLimit(planMeta, "staff");
  // A null base means unlimited — adding purchased seats to it is meaningless.
  const staffSeats = baseStaff === null ? null : baseStaff + extraStaffSeats;

  return {
    businessId,
    subscriptionId: sub.id,
    planId: sub.plan_id,
    planName: plan.name ?? null,
    status: sub.status,
    entitled: true,
    reason,
    seats: { staff: staffSeats, logins: readLimit(planMeta, "logins") },
    dashboard: planMeta["dashboard"] === "full" ? "full" : "basic",
    marketingEmailsPerMonth: readLimit(planMeta, "marketingEmailsPerMonth"),
    includedTokens: readLimit(planMeta, "includedTokens"),
    whatsappSession: planMeta["whatsappSession"] === true,
    grants,
    addonQuantities,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    trialEndsAt: sub.status === "trialing" ? sub.current_period_end : null,
  };
}

/** Convenience for call sites that only care about one add-on. */
export async function hasGrant(businessId: string, addon: AddonId): Promise<boolean> {
  const ent = await getEntitlements(businessId);
  return ent.entitled && ent.grants[addon];
}
