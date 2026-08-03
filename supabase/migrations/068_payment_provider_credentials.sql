-- ============================================================================
-- Migration 068: Real per-business PayFast credentials
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Deliberately a SEPARATE table from public.payment_provider_settings (001).
-- That table's RLS is "FOR ALL USING/WITH CHECK user_owns_business" — the
-- owner's own browser session can read it back, which is fine for the
-- enabled/connected/config placeholder it holds today, but NOT fine for a
-- PayFast passphrase: that value is used purely server-side to sign/verify
-- ITN webhooks, and if it ever reached the browser, anyone could forge a
-- "deposit paid" webhook call for that business.
--
-- So this table gets RLS enabled with ZERO policies — no SELECT/INSERT/
-- UPDATE/DELETE grant to anon or authenticated at all. Only the service-role
-- client (Express, via getSupabaseAdmin()) can touch it, same as every other
-- service-role-only table in this schema, except here we're not even adding
-- an owner-read policy the way email_domains does for its non-secret fields.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_provider_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'payfast' CHECK (provider = 'payfast'),
  merchant_id  TEXT,
  merchant_key TEXT,
  passphrase   TEXT,
  mode         TEXT NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'live')),
  enabled      BOOLEAN NOT NULL DEFAULT false,
  connected    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_provider_credentials_business_id_idx
  ON public.payment_provider_credentials(business_id);

DROP TRIGGER IF EXISTS payment_provider_credentials_updated_at ON public.payment_provider_credentials;
CREATE TRIGGER payment_provider_credentials_updated_at
  BEFORE UPDATE ON public.payment_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_provider_credentials ENABLE ROW LEVEL SECURITY;
-- No policies. Enabling RLS with no policies denies all access to every role
-- except the service role (which bypasses RLS entirely) — that's intentional.
