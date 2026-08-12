-- ============================================================================
-- Migration 053: Allow campaigns to end in a "halted, out of credits" state
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Campaign sending now charges tokens per successful dispatch (pricing.md §9).
-- A campaign can therefore stop part-way when the balance runs dry — most likely
-- when a concurrent campaign drains it after this one's pre-flight check passed.
--
-- That outcome is NOT 'completed': some recipients never received the message and
-- the customer has to know. The status CHECK from migration 014 only allowed
-- draft/active/completed, so writing the new value would raise — inside a
-- setImmediate background task, where the error surfaces to nobody.
-- ============================================================================

ALTER TABLE public.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_status_check;

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'halted_no_credits'));
