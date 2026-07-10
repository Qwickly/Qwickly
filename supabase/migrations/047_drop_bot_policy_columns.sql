-- ============================================================================
-- Migration 047: Drop the vestigial policy columns from whatsapp_bot_settings
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Migration 046 moved the cancel/reschedule policy to the core booking_policies
-- table and pointed all readers at it. The old whatsapp_bot_settings columns have
-- been left unused since then (frontend + backend no longer read/write them).
-- This removes them for good.
--
-- Run AFTER deploying the code that stops referencing these columns
-- (bot-settings.ts, whatsapp-bot.tsx, whatsapp-ai.ts). Safe order: deploy code →
-- run this. IF EXISTS keeps it idempotent.
-- ============================================================================

-- ── 1. Seed a booking_policies row for every NEW business ────────────────────
-- Existing businesses were backfilled in migration 046; this keeps future ones
-- covered so there's always a concrete policy row (readers still default to
-- permissive if a row is somehow missing).
CREATE OR REPLACE FUNCTION public.seed_booking_policy()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.booking_policies (business_id)
  VALUES (NEW.id)
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS businesses_seed_booking_policy ON public.businesses;
CREATE TRIGGER businesses_seed_booking_policy
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.seed_booking_policy();

-- ── 2. Drop the now-unused policy columns ────────────────────────────────────
ALTER TABLE public.whatsapp_bot_settings
  DROP COLUMN IF EXISTS accept_cancellations,
  DROP COLUMN IF EXISTS cancellation_min_notice_hours,
  DROP COLUMN IF EXISTS cancellation_decline_message,
  DROP COLUMN IF EXISTS accept_reschedules,
  DROP COLUMN IF EXISTS reschedule_min_notice_hours,
  DROP COLUMN IF EXISTS reschedule_decline_message;
