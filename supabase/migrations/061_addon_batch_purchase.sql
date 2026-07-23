-- ============================================================================
-- Migration 061: Allow several add-ons to share one pro-rata payment
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Migration 055 gave subscription_addon_purchases a UNIQUE payment_ref: one
-- PayFast payment settled exactly one add-on. That was fine when the UI attached
-- add-ons one at a time, but it forced a business adding three features to run
-- three separate checkouts.
--
-- Batch checkout attaches several add-ons with a SINGLE PayFast payment: one
-- shared payment_ref, one row per add-on, the amount being the sum of the lines.
-- That needs the uniqueness to move from (payment_ref) to (payment_ref, addon_id):
--
--   • Still idempotent — a retried ITN can't insert a second row for the same
--     (payment_ref, addon_id), and the webhook additionally skips rows already
--     marked 'completed'.
--   • Still one line per add-on per payment — a batch can't list the chatbot twice.
--
-- The single-add-on path is unchanged: it just happens to use a payment_ref that
-- appears on exactly one row.
-- ============================================================================

-- Drop the old single-column unique constraint. Migration 055 created it
-- implicitly via `payment_ref TEXT NOT NULL UNIQUE`, which Postgres names
-- <table>_<column>_key. IF EXISTS makes this safe to re-run.
ALTER TABLE public.subscription_addon_purchases
  DROP CONSTRAINT IF EXISTS subscription_addon_purchases_payment_ref_key;

-- One add-on may appear at most once per payment reference.
ALTER TABLE public.subscription_addon_purchases
  DROP CONSTRAINT IF EXISTS subscription_addon_purchases_ref_addon_key;
ALTER TABLE public.subscription_addon_purchases
  ADD CONSTRAINT subscription_addon_purchases_ref_addon_key
  UNIQUE (payment_ref, addon_id);

-- The webhook looks up every row for a payment_ref to settle a batch at once.
CREATE INDEX IF NOT EXISTS subscription_addon_purchases_ref_idx
  ON public.subscription_addon_purchases(payment_ref);
