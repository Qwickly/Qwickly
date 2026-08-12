-- Authenticated-business variant of get_public_booking_slots, for the admin
-- Calendar "New booking" dialog, which already knows its own business_id via
-- ensureBusiness() and shouldn't need to round-trip through a booking page
-- slug to get there.
--
-- Refactors the slot-walking logic out of get_public_booking_slots into a
-- shared core (public.compute_available_slots), so the public (by-slug) and
-- authenticated (by-business_id) entry points stay in sync instead of
-- duplicating the loop.

-- ── Shared slot-walking core ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_available_slots(
  p_business_id UUID,
  p_service_id UUID,
  p_date DATE,
  p_staff_id UUID DEFAULT NULL
)
RETURNS TABLE (start_time TEXT, end_time TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration INTEGER;
  v_day_name TEXT;
  v_is_open BOOLEAN;
  v_open_time TIME;
  v_close_time TIME;
  v_slot_start TIME;
  v_slot_end TIME;
  v_step INTERVAL := INTERVAL '15 minutes';
  v_slot_start_ts TIMESTAMPTZ;
  v_slot_end_ts TIMESTAMPTZ;
BEGIN
  SELECT duration INTO v_duration
  FROM public.services
  WHERE id = p_service_id
    AND business_id = p_business_id
    AND is_active = true
  LIMIT 1;

  IF v_duration IS NULL THEN
    RETURN;
  END IF;

  v_day_name := lower(trim(to_char(p_date, 'Day')));

  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.business_operating_hours
  WHERE business_id = p_business_id AND day_name = v_day_name
  LIMIT 1;

  IF v_is_open IS NOT TRUE THEN
    RETURN;
  END IF;

  IF p_staff_id IS NOT NULL THEN
    PERFORM 1
    FROM public.staff_members
    WHERE id = p_staff_id
      AND business_id = p_business_id
      AND is_active = true
      AND working_days @> ARRAY[v_day_name];

    IF NOT FOUND THEN
      RETURN;
    END IF;
  END IF;

  v_slot_start := v_open_time;

  WHILE v_slot_start + make_interval(mins => v_duration) <= v_close_time LOOP
    v_slot_end := v_slot_start + make_interval(mins => v_duration);
    v_slot_start_ts := (p_date + v_slot_start) AT TIME ZONE 'Africa/Johannesburg';
    v_slot_end_ts := (p_date + v_slot_end) AT TIME ZONE 'Africa/Johannesburg';

    IF v_slot_start_ts > now()
      AND public.public_booking_slot_is_free(p_business_id, p_staff_id, v_day_name, v_slot_start_ts, v_slot_end_ts)
    THEN
      start_time := to_char(v_slot_start, 'HH24:MI');
      end_time := to_char(v_slot_end, 'HH24:MI');
      RETURN NEXT;
    END IF;

    v_slot_start := v_slot_start + v_step;
  END LOOP;

  RETURN;
END;
$$;

-- Internal helper only - see the matching REVOKE on public_booking_slot_is_free
-- in 015_public_booking_slots.sql for why: Postgres grants EXECUTE to PUBLIC
-- by default, which would let anon/authenticated call this directly with an
-- arbitrary business_id, bypassing get_business_booking_slots' ownership check.
REVOKE EXECUTE ON FUNCTION public.compute_available_slots(
  UUID, UUID, DATE, UUID
) FROM PUBLIC;

-- ── Public (by-slug) entry point - now just resolves business_id and delegates ─
CREATE OR REPLACE FUNCTION public.get_public_booking_slots(
  p_slug TEXT,
  p_service_id UUID,
  p_date DATE,
  p_staff_id UUID DEFAULT NULL
)
RETURNS TABLE (start_time TEXT, end_time TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.booking_page_settings
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.compute_available_slots(v_business_id, p_service_id, p_date, p_staff_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_booking_slots(
  TEXT, UUID, DATE, UUID
) TO anon, authenticated;

-- ── Authenticated (by-business_id) entry point, for the admin dashboard ─────
CREATE OR REPLACE FUNCTION public.get_business_booking_slots(
  p_business_id UUID,
  p_service_id UUID,
  p_date DATE,
  p_staff_id UUID DEFAULT NULL
)
RETURNS TABLE (start_time TEXT, end_time TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_owns_business(p_business_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.compute_available_slots(p_business_id, p_service_id, p_date, p_staff_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_business_booking_slots(
  UUID, UUID, DATE, UUID
) TO authenticated;
