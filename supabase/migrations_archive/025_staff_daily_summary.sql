-- ============================================================================
-- Migration 025: Staff Daily Summary
-- Makes the existing "Daily Schedule Summary" toggle real. A once-a-day job
-- enqueues a 'daily_summary' staff_notification (reusing the hardened worker
-- from migration 024). Daily summaries are not tied to a booking, so booking_id
-- becomes nullable and a marker table guarantees one summary per staff per day.
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- ── 1. Allow non-booking staff notifications ─────────────────────────────────

ALTER TABLE public.staff_notifications
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.staff_notifications
  DROP CONSTRAINT IF EXISTS staff_notifications_notification_type_check;

ALTER TABLE public.staff_notifications
  ADD CONSTRAINT staff_notifications_notification_type_check
  CHECK (notification_type IN ('new_booking', 'cancellation', 'reschedule', 'daily_summary'));

-- ── 2. Idempotency marker: one summary per staff per SAST day ────────────────
-- The enqueuer claims a row here (ON CONFLICT DO NOTHING) before inserting the
-- notification, so a server restart or overlapping run can't double-send.

CREATE TABLE IF NOT EXISTS public.staff_daily_summary_log (
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, summary_date)
);

CREATE INDEX IF NOT EXISTS staff_daily_summary_log_business_id_idx
  ON public.staff_daily_summary_log(business_id);

ALTER TABLE public.staff_daily_summary_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_daily_summary_log_select_own" ON public.staff_daily_summary_log;
CREATE POLICY "staff_daily_summary_log_select_own" ON public.staff_daily_summary_log
  FOR SELECT USING (public.user_owns_business(business_id));
