import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";

/**
 * Real per-business PayFast credentials (migration 068). Deliberately
 * separate from the /settings payment_provider_settings table — this one
 * holds a merchant passphrase, so reads/writes only ever go through the
 * service-role client here, never directly from the browser.
 */

const router = Router();

async function getBusinessForUser(userId: string): Promise<{ id: string }> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(error?.message || "Business not found");
  return data as { id: string };
}

type CredentialsRow = {
  merchant_id: string | null;
  merchant_key: string | null;
  passphrase: string | null;
  mode: "sandbox" | "live";
  enabled: boolean;
  connected: boolean;
};

function maskKey(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

router.get("/payment-providers/payfast", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.json({ provider: null });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);

    const { data, error } = await getSupabaseAdmin()
      .from("payment_provider_credentials")
      .select("merchant_id, merchant_key, passphrase, mode, enabled, connected")
      .eq("business_id", business.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const row = data as CredentialsRow | null;

    if (!row) {
      return res.json({ provider: null });
    }

    // Never return the passphrase or the raw merchant key — only enough to
    // render the settings UI (masked key, whether one is set at all).
    return res.json({
      provider: {
        merchantId: row.merchant_id,
        merchantKeyMasked: maskKey(row.merchant_key),
        hasPassphrase: Boolean(row.passphrase),
        mode: row.mode,
        enabled: row.enabled,
        connected: row.connected,
      },
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not load PayFast settings" });
  }
});

router.post("/payment-providers/payfast", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);

    const merchantId = typeof req.body?.merchantId === "string" ? req.body.merchantId.trim() : "";
    const merchantKey = typeof req.body?.merchantKey === "string" ? req.body.merchantKey.trim() : "";
    const passphrase = typeof req.body?.passphrase === "string" ? req.body.passphrase.trim() : "";
    const mode = req.body?.mode === "live" ? "live" : "sandbox";

    if (!merchantId || !merchantKey) {
      return res.status(400).json({ error: "Merchant ID and Merchant Key are required" });
    }

    const supa = getSupabaseAdmin();

    // Keep the existing passphrase if the caller didn't send a new one (so
    // re-saving mode/merchant details doesn't require re-entering the secret
    // every time — the GET route never echoes it back for editing).
    const { data: existing } = await supa
      .from("payment_provider_credentials")
      .select("passphrase")
      .eq("business_id", business.id)
      .maybeSingle();

    const { error } = await supa
      .from("payment_provider_credentials")
      .upsert(
        {
          business_id: business.id,
          provider: "payfast",
          merchant_id: merchantId,
          merchant_key: merchantKey,
          passphrase: passphrase || (existing as { passphrase: string | null } | null)?.passphrase || null,
          mode,
          enabled: true,
          connected: true,
        },
        { onConflict: "business_id" },
      );

    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not save PayFast settings" });
  }
});

router.delete("/payment-providers/payfast", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);

    const { error } = await getSupabaseAdmin()
      .from("payment_provider_credentials")
      .delete()
      .eq("business_id", business.id);

    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not remove PayFast settings" });
  }
});

export default router;
