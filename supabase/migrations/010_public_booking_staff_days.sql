-- Enforce staff working days for public bookings (defense-in-depth)

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

    v_day := lower(trim(to_char(p_start_time, 'Day')));
    IF NOT (v_staff_days @> ARRAY[v_day]) THEN
      RAISE EXCEPTION 'Selected staff member is not available on this day';
    END IF;
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

  v_end_time := p_start_time + make_interval(mins => v_duration);

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
