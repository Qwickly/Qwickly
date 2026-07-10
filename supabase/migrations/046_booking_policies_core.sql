-- ============================================================================
-- Migration 046: Move cancel/reschedule policy into a CORE table
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- The cancellation/reschedule rules (accept toggles + notice windows + decline
-- messages) used to live on whatsapp_bot_settings (migration 032). But the
-- booking calendar / public booking page is a BASE feature while the bot is an
-- upsell, so a base feature shouldn't depend on the bot's table. This promotes
-- the policy to a core per-business table that ALL channels read:
--   • the public "manage booking" RPCs (migration 045)
--   • the WhatsApp bot (whatsapp-ai.ts fetchBotSettingsForBusiness)
--   • a new core Settings UI (replacing the Bot Setup editor)
--
-- The old whatsapp_bot_settings policy columns are left in place (now vestigial)
-- so nothing breaks mid-deploy; they can be dropped in a later cleanup.
-- ============================================================================

-- ── 1. Core policy table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_policies (
  business_id                   UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  accept_cancellations          BOOLEAN NOT NULL DEFAULT true,
  cancellation_min_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (cancellation_min_notice_hours >= 0),
  cancellation_decline_message  TEXT    NOT NULL DEFAULT '',
  accept_reschedules            BOOLEAN NOT NULL DEFAULT true,
  reschedule_min_notice_hours   INTEGER NOT NULL DEFAULT 24 CHECK (reschedule_min_notice_hours >= 0),
  reschedule_decline_message    TEXT    NOT NULL DEFAULT '',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Backfill from whatsapp_bot_settings (or defaults) for every business ──
-- One row per business so every business starts with a concrete policy.
INSERT INTO public.booking_policies (
  business_id,
  accept_cancellations,
  cancellation_min_notice_hours,
  cancellation_decline_message,
  accept_reschedules,
  reschedule_min_notice_hours,
  reschedule_decline_message
)
SELECT
  b.id,
  COALESCE(w.accept_cancellations, true),
  COALESCE(w.cancellation_min_notice_hours, 24),
  COALESCE(w.cancellation_decline_message, ''),
  COALESCE(w.accept_reschedules, true),
  COALESCE(w.reschedule_min_notice_hours, 24),
  COALESCE(w.reschedule_decline_message, '')
FROM public.businesses b
LEFT JOIN public.whatsapp_bot_settings w ON w.business_id = b.id
ON CONFLICT (business_id) DO NOTHING;

-- ── 3. RLS — owners manage their own policy (Settings UI uses the user client) ─
ALTER TABLE public.booking_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_policies_select_own" ON public.booking_policies;
CREATE POLICY "booking_policies_select_own" ON public.booking_policies
  FOR SELECT USING (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "booking_policies_insert_own" ON public.booking_policies;
CREATE POLICY "booking_policies_insert_own" ON public.booking_policies
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "booking_policies_update_own" ON public.booking_policies;
CREATE POLICY "booking_policies_update_own" ON public.booking_policies
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS booking_policies_updated_at ON public.booking_policies;
CREATE TRIGGER booking_policies_updated_at
  BEFORE UPDATE ON public.booking_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Repoint the manage-booking RPCs (migration 045) at booking_policies ───
-- Only change vs migration 045: policy is read from booking_policies (bp), not
-- whatsapp_bot_settings (wbs).

CREATE OR REPLACE FUNCTION public.get_booking_by_manage_token(p_token UUID)
RETURNS TABLE (
  booking_id      UUID,
  status          TEXT,
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  service_id      UUID,
  service_name    TEXT,
  staff_id        UUID,
  staff_name      TEXT,
  business_id     UUID,
  business_name   TEXT,
  business_slug   TEXT,
  client_name     TEXT,
  can_cancel      BOOLEAN,
  can_reschedule  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.status,
    b.start_time,
    b.end_time,
    b.service_id,
    s.name,
    b.staff_id,
    sm.name,
    b.business_id,
    biz.business_name,
    bps.slug,
    c.name,
    (
      b.status IN ('pending', 'confirmed')
      AND COALESCE(bp.accept_cancellations, true)
      AND b.start_time > now() + make_interval(hours => COALESCE(bp.cancellation_min_notice_hours, 0))
    ),
    (
      b.status IN ('pending', 'confirmed')
      AND COALESCE(bp.accept_reschedules, true)
      AND b.start_time > now() + make_interval(hours => COALESCE(bp.reschedule_min_notice_hours, 0))
    )
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id
  JOIN public.businesses biz ON biz.id = b.business_id
  LEFT JOIN public.staff_members sm ON sm.id = b.staff_id
  LEFT JOIN public.clients c ON c.id = b.client_id
  LEFT JOIN public.booking_page_settings bps ON bps.business_id = b.business_id
  LEFT JOIN public.booking_policies bp ON bp.business_id = b.business_id
  WHERE b.manage_token = p_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking_by_manage_token(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking       public.bookings%ROWTYPE;
  v_accept        BOOLEAN;
  v_notice_hours  INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE manage_token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking can no longer be cancelled';
  END IF;

  SELECT COALESCE(accept_cancellations, true), COALESCE(cancellation_min_notice_hours, 0)
    INTO v_accept, v_notice_hours
  FROM public.booking_policies WHERE business_id = v_booking.business_id;

  IF v_accept IS NULL THEN
    v_accept := true;
    v_notice_hours := 0;
  END IF;

  IF NOT v_accept THEN
    RAISE EXCEPTION 'Cancellations are not accepted online for this business';
  END IF;

  IF v_booking.start_time <= now() + make_interval(hours => v_notice_hours) THEN
    RAISE EXCEPTION 'This booking is too close to its start time to cancel online';
  END IF;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_booking.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_booking_by_manage_token(
  p_token UUID,
  p_new_start TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking       public.bookings%ROWTYPE;
  v_accept        BOOLEAN;
  v_notice_hours  INTEGER;
  v_duration      INTEGER;
  v_new_end       TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE manage_token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'This booking can no longer be rescheduled';
  END IF;

  SELECT COALESCE(accept_reschedules, true), COALESCE(reschedule_min_notice_hours, 0)
    INTO v_accept, v_notice_hours
  FROM public.booking_policies WHERE business_id = v_booking.business_id;

  IF v_accept IS NULL THEN
    v_accept := true;
    v_notice_hours := 0;
  END IF;

  IF NOT v_accept THEN
    RAISE EXCEPTION 'Reschedules are not accepted online for this business';
  END IF;

  IF v_booking.start_time <= now() + make_interval(hours => v_notice_hours) THEN
    RAISE EXCEPTION 'This booking is too close to its start time to reschedule online';
  END IF;

  IF p_new_start <= now() THEN
    RAISE EXCEPTION 'Please choose a future time';
  END IF;

  SELECT duration INTO v_duration FROM public.services WHERE id = v_booking.service_id;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Service no longer available';
  END IF;

  v_new_end := p_new_start + make_interval(mins => v_duration);

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id <> v_booking.id
      AND b.status IN ('pending', 'confirmed')
      AND (
        (v_booking.staff_id IS NOT NULL AND b.staff_id = v_booking.staff_id)
        OR (v_booking.staff_id IS NULL AND b.business_id = v_booking.business_id)
      )
      AND tstzrange(b.start_time, b.end_time) && tstzrange(p_new_start, v_new_end)
  ) THEN
    RAISE EXCEPTION 'That time is no longer available';
  END IF;

  UPDATE public.bookings
  SET start_time = p_new_start,
      end_time = v_new_end
  WHERE id = v_booking.id;
  RETURN true;
END;
$$;
