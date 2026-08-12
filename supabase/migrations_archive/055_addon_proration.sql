-- ============================================================================
-- Migration 055: Add-on proration + scheduled removal
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Two problems with the first cut of add-ons:
--
-- 1. ATTACHING WAS FREE UNTIL THE NEXT CHARGE. Only the recurring amount was
--    updated, so a customer billed on the 1st could add every add-on on the 2nd,
--    use them for 29 days, remove them on the 30th, and be charged the base plan
--    only. Repeatable forever. Fixed by charging pro-rata for the remainder of
--    the current period BEFORE the add-on is attached.
--
-- 2. REMOVING KILLED THE FEATURE INSTANTLY. If someone paid pro-rata through the
--    end of the period, deleting the row took the feature away immediately with
--    no refund. Fixed with `remove_at`: the row survives, the feature stays live
--    until the period ends, and the recurring amount drops from the next cycle.
--
-- Why this needs a pending-purchase table when credit bundles didn't:
-- a bundle's price is FIXED in credit_bundles, so the webhook can re-read it and
-- check it against what was paid. A pro-rata amount depends on the day it was
-- calculated, so it cannot be re-derived later — it has to be recorded up front
-- and then verified against the payment.
-- ============================================================================

-- ── 1. Scheduled removal ─────────────────────────────────────────────────────
-- NULL = active and renewing. Non-NULL = paid up to this moment, still entitled
-- until then, not renewing. The entitlement resolver honours this, so no worker
-- is needed to sweep expired rows.
ALTER TABLE public.subscription_addons
  ADD COLUMN IF NOT EXISTS remove_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscription_addons.remove_at IS
  'When set, the add-on was cancelled but is paid through this timestamp. Entitlements remain until then; the recurring amount already excludes it.';

-- ── 2. Pending pro-rata purchases ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_addon_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  addon_id        TEXT NOT NULL REFERENCES public.plan_addons(id) ON DELETE RESTRICT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  -- The pro-rata amount quoted to the customer. The webhook checks amount_gross
  -- against exactly this — it cannot recompute it, because the answer depends on
  -- when the quote was made.
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  -- Audit of how the quote was reached, so a billing query years later is answerable.
  days_remaining  INTEGER NOT NULL,
  days_in_period  INTEGER NOT NULL,
  -- PayFast m_payment_id. Unique so an ITN retry can't attach twice.
  payment_ref     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS subscription_addon_purchases_business_idx
  ON public.subscription_addon_purchases(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS subscription_addon_purchases_pending_idx
  ON public.subscription_addon_purchases(status) WHERE status = 'pending';

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.subscription_addon_purchases ENABLE ROW LEVEL SECURITY;

-- Owners can read their own purchase history...
DROP POLICY IF EXISTS "subscription_addon_purchases_select_own"
  ON public.subscription_addon_purchases;
CREATE POLICY "subscription_addon_purchases_select_own"
  ON public.subscription_addon_purchases
  FOR SELECT USING (public.user_owns_business(business_id));

-- ...and write nothing. Quotes are made and settled by the service role only;
-- a client-writable amount_cents would be a "pay R1 for the chatbot" button.
