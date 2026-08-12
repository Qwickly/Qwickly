-- ============================================================================
-- Migration 056: One free trial per business
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Nothing stopped a business from starting a fresh 14-day trial every time it
-- cancelled — effectively free forever, 14 days at a time. This records when a
-- business first entered a trial; the checkout flow then refuses to grant a
-- second one and bills immediately instead (standard SaaS "one trial ever").
--
-- Set (once) by the PayFast webhook the moment a subscription first becomes
-- 'trialing' — NOT at checkout creation, so an abandoned checkout that never
-- actually started a trial doesn't burn the business's one shot.
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMPTZ;

COMMENT ON COLUMN public.businesses.trial_used_at IS
  'When this business first started its free trial. Once set, no further trials are granted — re-subscribing bills immediately.';
