-- ============================================================================
-- Migration 052: Credit balances, ledger, and atomic spend
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Two prepaid balances per business (pricing.md §9-§11):
--   whatsapp_tokens   → outbound WhatsApp MARKETING only. 5 tokens = cold contact
--                       via the Meta API (real R0.80 cost), 1 token = existing
--                       contact from the business's own number (~R0 cost).
--   marketing_emails  → outbound marketing email only.
--
-- Transactional notifications (booking confirmations, reminders, cancellations)
-- are UNLIMITED and never touch these balances. Do not wire them in here.
--
-- Each balance has TWO buckets, because the pricing rules differ:
--   included_used → consumption against the plan's monthly allowance. Resets
--                   each BILLING month (not calendar month). Starter: 100 emails,
--                   0 tokens.
--   purchased     → bought in bundles. Never expires while the subscription is
--                   active; forfeited on cancellation (no refund, §11).
-- "Included credits are used before purchased credits" is enforced in
-- spend_credits() below, not left to callers.
--
-- Why the caller passes included_limit + period_start rather than this function
-- reading the subscription: it keeps the function dumb and atomic. The TS
-- wrapper already resolves entitlements, so it knows both. See lib/credits.ts.
-- ============================================================================

-- ── 1. Balances ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_balances (
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('whatsapp_tokens', 'marketing_emails')),
  -- CHECK >= 0 is a backstop: even a bug in spend_credits() cannot drive a
  -- balance negative, it will raise instead.
  purchased     INTEGER NOT NULL DEFAULT 0 CHECK (purchased >= 0),
  included_used INTEGER NOT NULL DEFAULT 0 CHECK (included_used >= 0),
  -- The billing period this included_used belongs to. Lazily rolled forward by
  -- spend_credits() — no cron job to miss.
  period_start  DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, kind)
);

DROP TRIGGER IF EXISTS credit_balances_updated_at ON public.credit_balances;
CREATE TRIGGER credit_balances_updated_at
  BEFORE UPDATE ON public.credit_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Ledger (append-only audit) ────────────────────────────────────────────
-- Every movement, including free ones. Unlimited plans still write spend rows so
-- there is a usage record for fair-use monitoring (pricing.md §14.4).
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('whatsapp_tokens', 'marketing_emails')),
  -- Negative = consumed, positive = granted/purchased.
  delta         INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (source IN (
                  'purchase', 'spend_included', 'spend_purchased',
                  'refund', 'adjustment', 'period_reset'
                )),
  -- Human/debug context, e.g. 'meta_cold_contact', 'session_existing_contact'.
  reason        TEXT,
  -- What it was for, e.g. a campaign id.
  ref_id        TEXT,
  -- Snapshot of `purchased` after this row. NULL when the movement didn't touch
  -- the purchased bucket (included spend, unlimited plans, period resets).
  balance_after INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_ledger_business_kind_idx
  ON public.credit_ledger(business_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_ref_idx
  ON public.credit_ledger(ref_id) WHERE ref_id IS NOT NULL;

-- Hard backstop against double-crediting a payment. PayFast retries an ITN until
-- it gets a 200, so the same purchase notification WILL arrive more than once —
-- and two retries can land concurrently. grant_credits() also takes a row lock,
-- but this index is what makes double-credit impossible rather than unlikely:
-- the second INSERT physically cannot commit.
--
-- Scoped to money-in rows only: spend rows share a ref_id (one campaign spends
-- many times) and must stay non-unique.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_ref_uniq
  ON public.credit_ledger (ref_id, source, kind)
  WHERE ref_id IS NOT NULL AND source IN ('purchase', 'refund');

-- ── 3. Bundle catalog ────────────────────────────────────────────────────────
-- Prices are read from here server-side at purchase time and NEVER from the
-- client — the mistake the custom plan builder makes today.
CREATE TABLE IF NOT EXISTS public.credit_bundles (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('whatsapp_tokens', 'marketing_emails')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS credit_bundles_updated_at ON public.credit_bundles;
CREATE TRIGGER credit_bundles_updated_at
  BEFORE UPDATE ON public.credit_bundles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- WhatsApp token packs (pricing.md §10)
INSERT INTO public.credit_bundles (id, kind, amount, price_cents, sort_order) VALUES
  ('tokens_100',   'whatsapp_tokens',   100,   3500, 1),
  ('tokens_500',   'whatsapp_tokens',   500,  15000, 2),
  ('tokens_1500',  'whatsapp_tokens',  1500,  40500, 3),
  ('tokens_5000',  'whatsapp_tokens',  5000, 120000, 4),
  ('tokens_10000', 'whatsapp_tokens', 10000, 210000, 5),
-- Marketing email packs (pricing.md §11)
  ('emails_250',   'marketing_emails',   250,  2500, 1),
  ('emails_500',   'marketing_emails',   500,  4500, 2),
  ('emails_1000',  'marketing_emails',  1000,  8500, 3),
  ('emails_5000',  'marketing_emails',  5000, 40000, 4),
  ('emails_10000', 'marketing_emails', 10000, 75000, 5)
ON CONFLICT (id) DO UPDATE
SET kind        = EXCLUDED.kind,
    amount      = EXCLUDED.amount,
    price_cents = EXCLUDED.price_cents,
    sort_order  = EXCLUDED.sort_order;

-- ── 4. spend_credits() — the atomic one ──────────────────────────────────────
-- Returns JSONB:
--   { ok, spent_included, spent_purchased, included_used, included_remaining,
--     purchased_remaining, unlimited }
--   { ok:false, error:'insufficient', shortfall, ... }  ← nothing is written
--
-- p_included_limit: the plan's monthly allowance. NULL = unlimited (dev_full_access).
-- p_period_start:   the subscription's current_period_start. Rolls included_used
--                   over when it advances.
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_business_id     UUID,
  p_kind            TEXT,
  p_amount          INTEGER,
  p_included_limit  INTEGER,
  p_period_start    DATE,
  p_reason          TEXT DEFAULT NULL,
  p_ref_id          TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_row               public.credit_balances%ROWTYPE;
  v_included_used     INTEGER;
  v_included_avail    INTEGER;
  v_from_included     INTEGER;
  v_from_purchased    INTEGER;
  v_unlimited         BOOLEAN := (p_included_limit IS NULL);
  v_period_rolled     BOOLEAN := false;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- Materialise the row, then lock it. The INSERT..DO NOTHING + SELECT FOR UPDATE
  -- pair is what makes concurrent sends safe: two workers spending at once
  -- serialise here instead of both reading the same balance and double-spending.
  INSERT INTO public.credit_balances (business_id, kind, period_start)
  VALUES (p_business_id, p_kind, COALESCE(p_period_start, CURRENT_DATE))
  ON CONFLICT (business_id, kind) DO NOTHING;

  SELECT * INTO v_row
  FROM public.credit_balances
  WHERE business_id = p_business_id AND kind = p_kind
  FOR UPDATE;

  -- Roll the included allowance over if the billing period advanced.
  IF p_period_start IS NOT NULL AND v_row.period_start < p_period_start THEN
    v_included_used := 0;
    v_period_rolled := true;
  ELSE
    v_included_used := v_row.included_used;
  END IF;

  IF v_unlimited THEN
    v_from_included  := p_amount;
    v_from_purchased := 0;
  ELSE
    v_included_avail := GREATEST(0, p_included_limit - v_included_used);
    v_from_included  := LEAST(p_amount, v_included_avail);
    v_from_purchased := p_amount - v_from_included;

    -- Not enough. Write nothing and let the caller decide what to tell the user.
    IF v_from_purchased > v_row.purchased THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'insufficient',
        'shortfall', v_from_purchased - v_row.purchased,
        'included_remaining', v_included_avail,
        'purchased_remaining', v_row.purchased
      );
    END IF;
  END IF;

  UPDATE public.credit_balances
  SET included_used = v_included_used + v_from_included,
      purchased     = purchased - v_from_purchased,
      period_start  = COALESCE(p_period_start, period_start)
  WHERE business_id = p_business_id AND kind = p_kind
  RETURNING * INTO v_row;

  IF v_period_rolled THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id)
    VALUES (p_business_id, p_kind, 0, 'period_reset',
            'included allowance reset for new billing period', NULL);
  END IF;

  -- Log the two buckets separately so usage and spend can be told apart later.
  IF v_from_included > 0 THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
    VALUES (p_business_id, p_kind, -v_from_included, 'spend_included', p_reason, p_ref_id, NULL);
  END IF;

  IF v_from_purchased > 0 THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
    VALUES (p_business_id, p_kind, -v_from_purchased, 'spend_purchased', p_reason, p_ref_id, v_row.purchased);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unlimited', v_unlimited,
    'spent_included', v_from_included,
    'spent_purchased', v_from_purchased,
    'included_used', v_row.included_used,
    'included_remaining',
      CASE WHEN v_unlimited THEN NULL
           ELSE GREATEST(0, p_included_limit - v_row.included_used) END,
    'purchased_remaining', v_row.purchased
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. grant_credits() — purchases, refunds, manual adjustments ──────────────
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_business_id UUID,
  p_kind        TEXT,
  p_amount      INTEGER,
  p_source      TEXT,
  p_reason      TEXT DEFAULT NULL,
  p_ref_id      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_row public.credit_balances%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  IF p_source NOT IN ('purchase', 'refund', 'adjustment') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_source');
  END IF;

  -- Materialise + LOCK the balance row before checking for a duplicate. Without
  -- the lock, two concurrent ITN retries can both pass the EXISTS check and both
  -- credit. Same pattern as spend_credits().
  INSERT INTO public.credit_balances (business_id, kind)
  VALUES (p_business_id, p_kind)
  ON CONFLICT (business_id, kind) DO NOTHING;

  SELECT * INTO v_row
  FROM public.credit_balances
  WHERE business_id = p_business_id AND kind = p_kind
  FOR UPDATE;

  -- Idempotency: a PayFast ITN legitimately arrives more than once (it retries
  -- until it gets a 200). Never credit the same reference twice.
  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE ref_id = p_ref_id AND source = p_source AND kind = p_kind
  ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'purchased_remaining', v_row.purchased
    );
  END IF;

  UPDATE public.credit_balances
  SET purchased = purchased + p_amount
  WHERE business_id = p_business_id AND kind = p_kind
  RETURNING * INTO v_row;

  INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
  VALUES (p_business_id, p_kind, p_amount, p_source, p_reason, p_ref_id, v_row.purchased);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'purchased_remaining', v_row.purchased);

-- Backstop: if a concurrent grant beat us to the unique index despite the lock
-- (different business_id+kind path, or a future caller that skips the lock), fail
-- safe by reporting the duplicate rather than raising.
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.credit_balances
    WHERE business_id = p_business_id AND kind = p_kind;
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'purchased_remaining', COALESCE(v_row.purchased, 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_bundles  ENABLE ROW LEVEL SECURITY;

-- Owners may READ their balance and history...
DROP POLICY IF EXISTS "credit_balances_select_own" ON public.credit_balances;
CREATE POLICY "credit_balances_select_own" ON public.credit_balances
  FOR SELECT USING (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "credit_ledger_select_own" ON public.credit_ledger;
CREATE POLICY "credit_ledger_select_own" ON public.credit_ledger
  FOR SELECT USING (public.user_owns_business(business_id));

-- ...and nothing else. No INSERT/UPDATE/DELETE policies anywhere: balances move
-- only through spend_credits()/grant_credits(), called by the service role.

-- The bundle catalog is public reference data (pricing page reads it logged out).
DROP POLICY IF EXISTS "credit_bundles_select_all" ON public.credit_bundles;
CREATE POLICY "credit_bundles_select_all" ON public.credit_bundles
  FOR SELECT USING (true);

-- ── 7. Lock the functions down ───────────────────────────────────────────────
-- SECURITY DEFINER means these bypass RLS, so being callable by an end user
-- would be a "give yourself 10,000 tokens" button. Service role only.
REVOKE ALL ON FUNCTION public.spend_credits(UUID, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_credits(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(UUID, TEXT, INTEGER, INTEGER, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;
