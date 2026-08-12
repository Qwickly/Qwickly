-- ============================================================================
-- Migration 045: Self-service booking management (magic-link token)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Lets a customer view / cancel / reschedule their own booking from a link in
-- their confirmation email — no account, no OTP. The link carries an
-- unguessable per-booking token; possessing it proves ownership of the email it
-- was sent to. All three RPCs are SECURITY DEFINER and keyed ONLY by the token,
-- so they're safe to call from the public (anon) client.
--
-- Cancel/reschedule reuse the business's existing change policy (the same
-- whatsapp_bot_settings notice-window + accept toggles the AI bot honours), so
-- web and chatbot rules match. Both actions go through normal UPDATEs, so the
-- existing notification trigger fires (cancellation / reschedule emails) for free.
-- ============================================================================

-- ── 1. Per-booking token ─────────────────────────────────────────────────────
-- Volatile default → Postgres backfills a unique token for every existing row.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS manage_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token_idx
  ON public.bookings(manage_token);

-- ── 2. Fetch a booking by token (safe public projection) ─────────────────────
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
DECLARE
  v_accept_cancellations BOOLEAN;
  v_accept_reschedules   BOOLEAN;
  v_cancel_notice        INTEGER;
  v_resched_notice       INTEGER;
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
    -- can_cancel / can_reschedule: only for a still-active future booking that
    -- clears the business's notice window and (for reschedule) its accept switch.
    (
      b.status IN ('pending', 'confirmed')
      AND COALESCE(wbs.accept_cancellations, true)
      AND b.start_time > now() + make_interval(hours => COALESCE(wbs.cancellation_min_notice_hours, 0))
    ),
    (
      b.status IN ('pending', 'confirmed')
      AND COALESCE(wbs.accept_reschedules, true)
      AND b.start_time > now() + make_interval(hours => COALESCE(wbs.reschedule_min_notice_hours, 0))
    )
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id
  JOIN public.businesses biz ON biz.id = b.business_id
  LEFT JOIN public.staff_members sm ON sm.id = b.staff_id
  LEFT JOIN public.clients c ON c.id = b.client_id
  LEFT JOIN public.booking_page_settings bps ON bps.business_id = b.business_id
  LEFT JOIN public.whatsapp_bot_settings wbs ON wbs.business_id = b.business_id
  WHERE b.manage_token = p_token;
END;
$$;

-- ── 3. Cancel by token ───────────────────────────────────────────────────────
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
  FROM public.whatsapp_bot_settings WHERE business_id = v_booking.business_id;

  IF v_accept IS NULL THEN
    v_accept := true;  -- no settings row → allow
    v_notice_hours := 0;
  END IF;

  IF NOT v_accept THEN
    RAISE EXCEPTION 'Cancellations are not accepted online for this business';
  END IF;

  IF v_booking.start_time <= now() + make_interval(hours => v_notice_hours) THEN
    RAISE EXCEPTION 'This booking is too close to its start time to cancel online';
  END IF;

  -- Normal UPDATE → fires manage_booking_client_notifications (cancellation notice).
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_booking.id;
  RETURN true;
END;
$$;

-- ── 4. Reschedule by token ───────────────────────────────────────────────────
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
  v_day_name      TEXT;
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
  FROM public.whatsapp_bot_settings WHERE business_id = v_booking.business_id;

  IF v_accept IS NULL THEN
    v_accept := true;
    v_notice_hours := 0;
  END IF;

  IF NOT v_accept THEN
    RAISE EXCEPTION 'Reschedules are not accepted online for this business';
  END IF;

  -- Notice window is measured against the CURRENT appointment time.
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
  v_day_name := lower(to_char(p_new_start AT TIME ZONE 'Africa/Johannesburg', 'FMday'));

  -- Availability: reuse the same overlap logic, but exclude THIS booking so it
  -- doesn't conflict with itself when nudged to a nearby time.
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

  -- Normal UPDATE → fires manage_booking_client_notifications (reschedule alert).
  UPDATE public.bookings
  SET start_time = p_new_start,
      end_time = v_new_end
  WHERE id = v_booking.id;
  RETURN true;
END;
$$;

-- ── 5. Grants (public/anon can call, keyed only by the unguessable token) ─────
GRANT EXECUTE ON FUNCTION public.get_booking_by_manage_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_manage_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking_by_manage_token(UUID, TIMESTAMPTZ) TO anon, authenticated;
