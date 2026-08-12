-- ============================================================================
-- Migration 043: Capture client email on public bookings
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- The public booking form now REQUIRES an email (it's how the customer gets a
-- confirmation, since a brand-new customer has no WhatsApp conversation with the
-- business yet — see the email-notifications work). This threads that email
-- through create_public_booking so it lands on the client record, which is what
-- the notification trigger reads to send the email.
--
-- Adding p_client_email changes the function's argument signature, which would
-- otherwise create a second overload and make calls ambiguous — so we DROP the
-- old 7-arg version first, then recreate and re-GRANT. Body is migration 033's
-- (monthly-limit) version plus email handling on the client upsert.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_public_booking(
  TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT
);

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_slug TEXT,
  p_service_id UUID,
  p_client_name TEXT,
  p_client_phone TEXT,
  p_start_time TIMESTAMPTZ,
  p_staff_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_client_email TEXT DEFAULT NULL
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
  v_monthly_limit INTEGER;
  v_bookings_this_month INTEGER;
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

  -- Check monthly booking limit
  SELECT COUNT(*)
  INTO v_bookings_this_month
  FROM public.bookings
  WHERE business_id = v_business_id
    AND start_time >= date_trunc('month', CURRENT_DATE)
    AND start_time < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month';

  RAISE NOTICE 'Bookings this month: % for business %', v_bookings_this_month, v_business_id;

  -- Get monthly limit from subscription metadata->custom_config
  SELECT COALESCE(
    (SELECT (subscriptions.metadata->'custom_config'->>'bookingsPerMonth')::INTEGER
     FROM public.subscriptions
     WHERE subscriptions.business_id = v_business_id
       AND subscriptions.status = 'active'
       AND subscriptions.metadata IS NOT NULL
       AND subscriptions.metadata->'custom_config' IS NOT NULL
       AND subscriptions.metadata->'custom_config'->>'bookingsPerMonth' IS NOT NULL
     LIMIT 1),
    100  -- Default limit
  )
  INTO v_monthly_limit;

  RAISE NOTICE 'Monthly limit from subscription metadata: %', v_monthly_limit;

  IF v_bookings_this_month >= v_monthly_limit THEN
    RAISE EXCEPTION 'Monthly booking limit reached. You have created % bookings this month. Your plan limit is %.', v_bookings_this_month, v_monthly_limit;
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

  -- Validate staff if provided
  IF p_staff_id IS NOT NULL THEN
    PERFORM 1
    FROM public.staff_members
    WHERE id = p_staff_id
      AND business_id = v_business_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or inactive staff member';
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
    -- status = 'new' is explicit (not relying on the column default): a booking-page
    -- customer has no WhatsApp conversation, so they must stay on the email channel.
    -- Only the WhatsApp inbound flow promotes a client to 'active'.
    INSERT INTO public.clients (business_id, name, phone, email, client_type, status)
    VALUES (
      v_business_id,
      COALESCE(NULLIF(BTRIM(p_client_name), ''), 'Guest'),
      COALESCE(p_client_phone, ''),
      NULLIF(BTRIM(p_client_email), ''),
      'new',
      'new'
    )
    RETURNING id INTO v_client_id;
  ELSE
    -- Keep existing phone; update name if we got a better one, and fill in the
    -- email if provided (COALESCE keeps any existing email rather than nulling it).
    UPDATE public.clients
    SET name = COALESCE(NULLIF(BTRIM(p_client_name), ''), name),
        email = COALESCE(NULLIF(BTRIM(p_client_email), ''), email)
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
  TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, TEXT
) TO anon, authenticated;
