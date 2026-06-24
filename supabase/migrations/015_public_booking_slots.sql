-- Calendly-style availability for the public booking page.
--
-- Adds:
--   1. public.public_booking_slot_is_free(...) - shared "is this slot free"
--      check, used by both the new slots RPC and create_public_booking.
--   2. public.get_public_booking_slots(...)    - returns bookable start/end
--      times for a given slug/service/date/staff, derived from
--      business_operating_hours + staff working_days + existing bookings.
--   3. create_public_booking(...) re-created with a slot-overlap check added
--      right before the insert, so a booking can never be created into a
--      slot another pending/confirmed booking already occupies.
--   4. A partial EXCLUDE constraint on bookings as DB-level defense in depth
--      against the same race, for staff-bound bookings.
--
-- All interval math here is done in local wall-clock time (open_time /
-- close_time are plain TIME columns) and converted to instants via
-- `AT TIME ZONE 'Africa/Johannesburg'`. South Africa has a single timezone
-- with no DST, and the existing create_public_booking flow already assumes
-- the browser's local time is SAST when it builds the ISO timestamp it
-- sends in - this keeps the server-side math consistent with that.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Shared availability check ────────────────────────────────────────────────
--
-- p_staff_id given: free iff no pending/confirmed booking for that staff
--   member overlaps the slot.
-- p_staff_id NULL, business has active staff: free iff at least one active
--   staff member who works that weekday is free for the slot.
-- p_staff_id NULL, business has no staff records at all: treat the business
--   itself as a single resource and check staff_id IS NULL bookings.
CREATE OR REPLACE FUNCTION public.public_booking_slot_is_free(
  p_business_id UUID,
  p_staff_id UUID,
  p_day_name TEXT,
  p_slot_start TIMESTAMPTZ,
  p_slot_end TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_staff_id IS NOT NULL THEN
    RETURN NOT EXISTS (
      SELECT 1
      FROM public.bookings
      WHERE staff_id = p_staff_id
        AND status IN ('pending', 'confirmed')
        AND tstzrange(start_time, end_time) && tstzrange(p_slot_start, p_slot_end)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE business_id = p_business_id AND is_active = true
  ) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.business_id = p_business_id
        AND sm.is_active = true
        AND sm.working_days @> ARRAY[p_day_name]
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.staff_id = sm.id
            AND b.status IN ('pending', 'confirmed')
            AND tstzrange(b.start_time, b.end_time) && tstzrange(p_slot_start, p_slot_end)
        )
    );
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE business_id = p_business_id
      AND staff_id IS NULL
      AND status IN ('pending', 'confirmed')
      AND tstzrange(start_time, end_time) && tstzrange(p_slot_start, p_slot_end)
  );
END;
$$;

-- Internal helper only - Postgres grants EXECUTE to PUBLIC by default on
-- function creation, which would let anon/authenticated call this directly
-- with an arbitrary business_id, bypassing the ownership checks the entry
-- points (get_public_booking_slots, get_business_booking_slots,
-- create_public_booking) are meant to enforce. Revoke it.
REVOKE EXECUTE ON FUNCTION public.public_booking_slot_is_free(
  UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;

-- ── Available slots for a date ───────────────────────────────────────────────
--
-- Looked up by slug only (no is_published filter) - availability data isn't
-- sensitive, and this RPC is also used by the business owner's booking-page
-- builder preview before they've published. Actual booking creation stays
-- gated by is_published in create_public_booking below.
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
  SELECT business_id INTO v_business_id
  FROM public.booking_page_settings
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  SELECT duration INTO v_duration
  FROM public.services
  WHERE id = p_service_id
    AND business_id = v_business_id
    AND is_active = true
  LIMIT 1;

  IF v_duration IS NULL THEN
    RETURN;
  END IF;

  v_day_name := lower(trim(to_char(p_date, 'Day')));

  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.business_operating_hours
  WHERE business_id = v_business_id AND day_name = v_day_name
  LIMIT 1;

  IF v_is_open IS NOT TRUE THEN
    RETURN;
  END IF;

  IF p_staff_id IS NOT NULL THEN
    PERFORM 1
    FROM public.staff_members
    WHERE id = p_staff_id
      AND business_id = v_business_id
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
      AND public.public_booking_slot_is_free(v_business_id, p_staff_id, v_day_name, v_slot_start_ts, v_slot_end_ts)
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

GRANT EXECUTE ON FUNCTION public.get_public_booking_slots(
  TEXT, UUID, DATE, UUID
) TO anon, authenticated;

-- ── Harden booking creation with an overlap check ────────────────────────────
--
-- Same shape as the version in 010_public_booking_staff_days.sql, with a
-- public_booking_slot_is_free() check added right before the insert so a
-- booking can't be created into a slot that's already taken, even if the
-- client's view of availability was stale.
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_slug TEXT,
  p_service_id UUID,
  p_client_name TEXT,
  p_client_phone TEXT,
  p_start_time TIMESTAMPTZ,
  p_staff_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_client_id UUID;
  v_duration INTEGER;
  v_price NUMERIC(10,2);
  v_end_time TIMESTAMPTZ;
  v_booking_id UUID;
  v_staff_days TEXT[];
  v_day TEXT;
BEGIN
  -- Validate published booking page for slug
  SELECT business_id
  INTO v_business_id
  FROM public.booking_page_settings
  WHERE slug = p_slug AND is_published = true
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Booking page not found or not published';
  END IF;

  -- Validate service and fetch price/duration
  SELECT duration, price
  INTO v_duration, v_price
  FROM public.services
  WHERE id = p_service_id
    AND business_id = v_business_id
    AND is_active = true
  LIMIT 1;

  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive service';
  END IF;

  v_day := lower(trim(to_char(p_start_time AT TIME ZONE 'Africa/Johannesburg', 'Day')));

  -- Validate staff if provided + enforce working day
  IF p_staff_id IS NOT NULL THEN
    SELECT working_days
    INTO v_staff_days
    FROM public.staff_members
    WHERE id = p_staff_id
      AND business_id = v_business_id
      AND is_active = true
    LIMIT 1;

    IF v_staff_days IS NULL THEN
      RAISE EXCEPTION 'Invalid or inactive staff member';
    END IF;

    IF NOT (v_staff_days @> ARRAY[v_day]) THEN
      RAISE EXCEPTION 'Selected staff member is not available on this day';
    END IF;
  END IF;

  v_end_time := p_start_time + make_interval(mins => v_duration);

  IF NOT public.public_booking_slot_is_free(v_business_id, p_staff_id, v_day, p_start_time, v_end_time) THEN
    RAISE EXCEPTION 'This time slot is no longer available';
  END IF;

  -- Find or create client by phone within business
  SELECT id
  INTO v_client_id
  FROM public.clients
  WHERE business_id = v_business_id
    AND phone = COALESCE(p_client_phone, '')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (business_id, name, phone, client_type)
    VALUES (
      v_business_id,
      COALESCE(NULLIF(BTRIM(p_client_name), ''), 'Guest'),
      COALESCE(p_client_phone, ''),
      'new'
    )
    RETURNING id INTO v_client_id;
  ELSE
    -- Keep existing phone; update name if we got a better one
    UPDATE public.clients
    SET name = COALESCE(NULLIF(BTRIM(p_client_name), ''), name)
    WHERE id = v_client_id;
  END IF;

  INSERT INTO public.bookings (
    business_id,
    client_id,
    service_id,
    staff_id,
    start_time,
    end_time,
    status,
    deposit_paid,
    total_amount,
    notes
  )
  VALUES (
    v_business_id,
    v_client_id,
    p_service_id,
    p_staff_id,
    p_start_time,
    v_end_time,
    'pending',
    false,
    COALESCE(v_price, 0),
    NULLIF(BTRIM(p_notes), '')
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  TEXT,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID,
  TEXT
) TO anon, authenticated;

-- ── DB-level defense in depth against the same race, for staff-bound bookings ─
-- (NULL staff_id rows are intentionally not covered here - see
-- public_booking_slot_is_free for how the no-staff-selected case is handled
-- at the application level instead.)
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_staff_no_overlap;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_staff_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (staff_id IS NOT NULL AND status IN ('pending', 'confirmed'));
