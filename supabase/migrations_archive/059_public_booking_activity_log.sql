-- ============================================================================
-- Migration 059: Log activity for public (online) bookings
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Dashboard actions (create/edit/cancel bookings, clients, services, staff) are
-- logged from the browser via lib/activity.ts#logActivity. Public booking-page
-- submissions run through this SECURITY DEFINER RPC as the anon role, so the
-- browser can't write their activity rows (RLS would reject them). Instead we
-- record the activity here, inside the function, where the definer's rights let
-- us insert into activity_events.
--
-- We log two things a business owner cares about seeing in the feed:
--   1. A client that was auto-created from an online booking.
--   2. The online booking itself (actor_type 'client' = came from a customer).
--
-- Body is migration 043's version (email handling) plus:
--   * v_client_created / v_service_name tracking
--   * two activity_events inserts before RETURN
-- Signature is unchanged, so no DROP/GRANT churn is needed — CREATE OR REPLACE
-- keeps the existing 8-arg overload and its grants.
-- ============================================================================

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
  v_client_created BOOLEAN := false;
  v_client_name TEXT;
  v_duration INTEGER;
  v_price NUMERIC(10,2);
  v_service_name TEXT;
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

  IF v_bookings_this_month >= v_monthly_limit THEN
    RAISE EXCEPTION 'Monthly booking limit reached. You have created % bookings this month. Your plan limit is %.', v_bookings_this_month, v_monthly_limit;
  END IF;

  -- Validate service and fetch price/duration/name
  SELECT duration, price, name
  INTO v_duration, v_price, v_service_name
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

    v_client_created := true;
  ELSE
    -- Keep existing phone; update name if we got a better one, and fill in the
    -- email if provided (COALESCE keeps any existing email rather than nulling it).
    UPDATE public.clients
    SET name = COALESCE(NULLIF(BTRIM(p_client_name), ''), name),
        email = COALESCE(NULLIF(BTRIM(p_client_email), ''), email)
    WHERE id = v_client_id;
  END IF;

  v_client_name := COALESCE(NULLIF(BTRIM(p_client_name), ''), 'Guest');

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

  -- Activity feed: a new customer record spawned by this online booking.
  IF v_client_created THEN
    INSERT INTO public.activity_events (
      business_id, actor_type, entity_type, entity_id, event_type, title, description
    )
    VALUES (
      v_business_id,
      'client',
      'client',
      v_client_id::text,
      'client_created',
      'New client added',
      v_client_name || ' (from online booking)'
    );
  END IF;

  -- Activity feed: the online booking request itself.
  INSERT INTO public.activity_events (
    business_id, actor_type, entity_type, entity_id, event_type, title, description
  )
  VALUES (
    v_business_id,
    'client',
    'booking',
    v_booking_id::text,
    'booking_created',
    'New online booking',
    v_client_name || ' · ' || COALESCE(v_service_name, 'Service') || ' · '
      || to_char(p_start_time, 'Dy DD Mon, HH24:MI')
  );

  RETURN v_booking_id;
END;
$$;
