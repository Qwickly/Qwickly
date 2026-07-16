import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { getEntitlements } from "../lib/entitlements";

const router = Router();

async function getBusinessForUser(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

/**
 * What the signed-in business is entitled to. Read-only: this reports, it does
 * not gate. UI uses it to show/hide; server call sites import getEntitlements
 * directly rather than going through HTTP.
 */
router.get("/entitlements", requireUser, async (req, res): Promise<void> => {
  try {
    if (!isSupabaseAdminConfigured()) {
      res.status(503).json({ error: "Supabase not configured" });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const entitlements = await getEntitlements(business.id);

    // Whether this business has already used its one free trial (migration 056).
    // Merged in here rather than threaded through the resolver's many return
    // paths — the UI needs it so the checkout button doesn't promise a trial that
    // won't be granted.
    const { data: biz } = await getSupabaseAdmin()
      .from("businesses")
      .select("trial_used_at")
      .eq("id", business.id)
      .maybeSingle();

    res.json({ ...entitlements, trialUsed: Boolean(biz?.trial_used_at) });
  } catch (error) {
    req.log.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[Entitlements] Failed to resolve",
    );
    res.status(500).json({ error: "Failed to load entitlements" });
  }
});

export default router;
