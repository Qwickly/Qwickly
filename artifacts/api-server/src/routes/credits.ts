import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import {
  getBalances,
  getCreditBundles,
  TOKENS_PER_COLD_CONTACT,
  TOKENS_PER_EXISTING_CONTACT,
  type CreditKind,
} from "../lib/credits";

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
 * Current balances for both kinds, plus the token rates the UI needs to show a
 * campaign's cost before it's sent. Read-only.
 */
router.get("/credits/balance", requireUser, async (req, res): Promise<void> => {
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

    const balances = await getBalances(business.id);
    res.json({
      balances,
      rates: {
        tokensPerExistingContact: TOKENS_PER_EXISTING_CONTACT,
        tokensPerColdContact: TOKENS_PER_COLD_CONTACT,
      },
    });
  } catch (error) {
    req.log.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[Credits] Failed to load balances",
    );
    res.status(500).json({ error: "Failed to load balances" });
  }
});

/** Bundle catalog for the top-up UI. Prices come from the DB, never the client. */
router.get("/credits/bundles", requireUser, async (req, res): Promise<void> => {
  try {
    if (!isSupabaseAdminConfigured()) {
      res.status(503).json({ error: "Supabase not configured" });
      return;
    }

    const kindParam = typeof req.query["kind"] === "string" ? req.query["kind"] : undefined;
    const kind =
      kindParam === "whatsapp_tokens" || kindParam === "marketing_emails"
        ? (kindParam as CreditKind)
        : undefined;

    const bundles = await getCreditBundles(kind);
    res.json({ bundles });
  } catch (error) {
    req.log.error(
      { err: error instanceof Error ? error.message : String(error) },
      "[Credits] Failed to load bundles",
    );
    res.status(500).json({ error: "Failed to load bundles" });
  }
});

export default router;
