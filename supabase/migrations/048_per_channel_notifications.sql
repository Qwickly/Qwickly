-- ============================================================================
-- Migration 048: Per-channel notification settings (Client + Staff × WhatsApp/Email)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Notifications become audience-first with independent channels:
--   • Client + Staff each get WhatsApp AND Email toggles per event.
--   • The EXISTING event columns become the WhatsApp toggles (WhatsApp was the
--     original channel), and we ADD a parallel `_email` column per event.
--   • staff_notifications gains a `channel` column so staff can be emailed too
--     (email is the reliable channel for internal staff; WhatsApp-web can't cold-
--     message a staff member who never opened a chat with the business number).
--
-- `email_enabled` (the old single master switch) is left in place but VESTIGIAL —
-- replaced by the per-event `_email` columns. Drop it in a later cleanup.
-- ============================================================================

-- ── 1. Client per-event EMAIL columns ────────────────────────────────────────
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS booking_confirmations_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_24h_email          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_2h_email           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_requests_email       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_notices_email  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rescheduling_alerts_email   BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Staff per-event EMAIL columns ─────────────────────────────────────────
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS staff_new_booking_email    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_reschedule_email     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_cancellation_email   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_daily_summary_email  BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Backfill from current behaviour ───────────────────────────────────────
-- Client: email previously fired only when the event was on AND the master
-- email_enabled was on — preserve exactly that.
UPDATE public.notification_settings SET
  booking_confirmations_email = booking_confirmations AND COALESCE(email_enabled, false),
  reminder_24h_email          = reminder_24h          AND COALESCE(email_enabled, false),
  reminder_2h_email           = reminder_2h           AND COALESCE(email_enabled, false),
  review_requests_email       = review_requests       AND COALESCE(email_enabled, false),
  cancellation_notices_email  = cancellation_notices  AND COALESCE(email_enabled, false),
  rescheduling_alerts_email   = rescheduling_alerts   AND COALESCE(email_enabled, false),
  -- Staff: turn on email for whatever the business already wanted. This is the
  -- fix — those staff events were failing over WhatsApp; now they reach staff by
  -- email (their WhatsApp toggle stays on too; they can turn it off in the UI).
  staff_new_booking_email     = staff_new_booking,
  staff_reschedule_email      = staff_reschedule,
  staff_cancellation_email    = staff_cancellation,
  staff_daily_summary_email   = staff_daily_summary;

-- ── 4. staff_notifications channel + per-channel dedup index ──────────────────
ALTER TABLE public.staff_notifications
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'email'));

-- The pending-dedup index (migration 024) must include channel now that one
-- staff event can fan out to two channels — otherwise the email insert collides.
DROP INDEX IF EXISTS public.staff_notifications_pending_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS staff_notifications_pending_uniq
  ON public.staff_notifications (booking_id, staff_id, notification_type, channel)
  WHERE status = 'pending';
