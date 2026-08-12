-- ============================================================================
-- Migration 024: Notification Queue Hardening
-- Adds retry/backoff + idempotency to the staff & client notification queues
-- (migrations 014/015) and a per-business auto-pause table so a disconnected
-- WhatsApp session stops hammering instead of failing every message forever.
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- ── 1. Retry/backoff columns on both queues ──────────────────────────────────
-- attempts        = how many times we've tried to send THIS message.
-- next_attempt_at = don't retry before this time (NULL = ready now). After a
--                   transient failure the worker sets this a few minutes out
--                   instead of marking the message permanently failed.

ALTER TABLE public.staff_notifications
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE public.client_notifications
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- Help the worker query find due-and-pending rows quickly.
CREATE INDEX IF NOT EXISTS staff_notifications_due_idx
  ON public.staff_notifications (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS client_notifications_due_idx
  ON public.client_notifications (next_attempt_at)
  WHERE status = 'pending';

-- ── 2. Idempotency: one pending message per (booking, type) ───────────────────
-- The triggers already DELETE pending dupes before inserting, but there is no
-- constraint enforcing it. Dedupe any existing pending dupes (keep newest),
-- then add a unique partial index as a hard guarantee.

DELETE FROM public.staff_notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY booking_id, staff_id, notification_type
      ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.staff_notifications
    WHERE status = 'pending'
  ) ranked
  WHERE ranked.rn > 1
);

DELETE FROM public.client_notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY booking_id, notification_type
      ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.client_notifications
    WHERE status = 'pending'
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_notifications_pending_uniq
  ON public.staff_notifications (booking_id, staff_id, notification_type)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS client_notifications_pending_uniq
  ON public.client_notifications (booking_id, notification_type)
  WHERE status = 'pending';

-- ── 3. Per-business send state (auto-pause) ──────────────────────────────────
-- When sends keep failing for a business (its WhatsApp is likely disconnected),
-- the worker bumps consecutive_failures and sets paused_until. While paused the
-- worker skips that business's queue, then auto-resumes after paused_until.

CREATE TABLE IF NOT EXISTS public.notification_send_state (
  business_id          UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  paused_until         TIMESTAMPTZ,
  last_error           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_send_state_paused_idx
  ON public.notification_send_state (paused_until)
  WHERE paused_until IS NOT NULL;

ALTER TABLE public.notification_send_state ENABLE ROW LEVEL SECURITY;

-- Owners can read their own pause state (for an in-app queue view later);
-- all writes happen via the service-role worker, which bypasses RLS.
DROP POLICY IF EXISTS "notification_send_state_select_own" ON public.notification_send_state;
CREATE POLICY "notification_send_state_select_own" ON public.notification_send_state
  FOR SELECT USING (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS notification_send_state_updated_at ON public.notification_send_state;
CREATE TRIGGER notification_send_state_updated_at
  BEFORE UPDATE ON public.notification_send_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
