-- ============================================================================
-- Migration 032: WhatsApp bot cancellation & reschedule policies
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ----------------------------------------------------------------------------
-- Makes the bot's cancel/reschedule rules business-configurable instead of
-- hardcoded. Previously: cancellations enforced a baked-in 24h notice window,
-- and reschedules had NO policy at all (always allowed, any notice).
--
-- All columns live on whatsapp_bot_settings alongside the existing
-- accept_cancellations toggle. Notice windows are in HOURS; 0 = no limit.
-- Decline messages are optional per-business overrides — empty string means the
-- bot uses its built-in wording (which interpolates the configured window).
-- ============================================================================

ALTER TABLE public.whatsapp_bot_settings
  -- Cancellation: accept_cancellations already exists as the on/off switch.
  -- This replaces the hardcoded 24h cutoff (0 = allow cancelling any time).
  ADD COLUMN IF NOT EXISTS cancellation_min_notice_hours INTEGER NOT NULL DEFAULT 24
    CHECK (cancellation_min_notice_hours >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_decline_message TEXT NOT NULL DEFAULT '',

  -- Reschedule: brand-new master switch + notice window (both had no equivalent).
  ADD COLUMN IF NOT EXISTS accept_reschedules BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reschedule_min_notice_hours INTEGER NOT NULL DEFAULT 24
    CHECK (reschedule_min_notice_hours >= 0),
  ADD COLUMN IF NOT EXISTS reschedule_decline_message TEXT NOT NULL DEFAULT '';
