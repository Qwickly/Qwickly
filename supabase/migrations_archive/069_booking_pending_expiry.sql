-- ============================================================================
-- Migration 069: Deposit gating + pending-booking expiry
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Adds bookings.pending_expires_at, set by create_public_booking whenever a
-- deposit is required so a background worker (booking-expiry.ts) can release
-- the slot if the customer never pays. A 'pending' booking already blocks its
-- slot (see get_public_booking_slots, 015_public_booking_slots.sql) — this
-- does not change that; it only adds an expiry to the hold.
--
-- create_public_booking keeps its exact 8-arg signature from migration 059
-- (CREATE OR REPLACE, no DROP/GRANT churn) and gains the same three-way
-- deposit precedence already used by whatsapp-ai.ts#calculateDepositAmount:
--   1. service.deposit_required (per-service override) wins if set
--   2. else booking_page_settings.require_deposit OR deposit_settings.require_deposit
--   Amount: service.deposit_amount if > 0, else deposit_settings (percentage
--   of price, or fixed amount).
-- ============================================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMPTZ;

-- Matches the expiry worker's query shape exactly (status='pending' AND
-- deposit_paid=false AND pending_expires_at < now()).
CREATE INDEX IF NOT EXISTS bookings_pending_expiry_idx
  ON public.bookings(pending_expires_at)
  WHERE status = 'pending' AND deposit_paid = false;

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
  v_service_deposit_required BOOLEAN;
  v_service_deposit_amount NUMERIC(10,2);
  v_end_time TIMESTAMPTZ;
  v_booking_id UUID;
  v_monthly_limit INTEGER;
  v_bookings_this_month INTEGER;
  v_page_require_deposit BOOLEAN;
  v_deposit_settings RECORD;
  v_deposit_required BOOLEAN;
  v_deposit_amount NUMERIC(10,2);
  v_pending_expires_at TIMESTAMPTZ;
BEGIN
  -- Validate published booking page for slug
  SELECT business_id, require_deposit
  INTO v_business_id, v_page_require_deposit
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

  -- Validate service and fetch price/duration/name + deposit override
  SELECT duration, price, name, deposit_required, deposit_amount
  INTO v_duration, v_price, v_service_name, v_service_deposit_required, v_service_deposit_amount
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

  -- ── Deposit precedence (mirrors whatsapp-ai.ts#calculateDepositAmount) ──────
  SELECT * INTO v_deposit_settings
  FROM public.deposit_settings
  WHERE business_id = v_business_id;

  v_deposit_required := COALESCE(v_service_deposit_required, false)
    OR COALESCE(v_page_require_deposit, false)
    OR (FOUND AND COALESCE(v_deposit_settings.require_deposit, false));

  IF v_deposit_required THEN
    IF COALESCE(v_service_deposit_amount, 0) > 0 THEN
      v_deposit_amount := v_service_deposit_amount;
    ELSIF FOUND THEN
      IF v_deposit_settings.deposit_type = 'percentage' THEN
        v_deposit_amount := ROUND(COALESCE(v_price, 0) * (v_deposit_settings.deposit_amount / 100), 2);
      ELSE
        v_deposit_amount := v_deposit_settings.deposit_amount;
      END IF;
    ELSE
      v_deposit_amount := 0;
    END IF;
    v_pending_expires_at := now() + INTERVAL '30 minutes';
  ELSE
    v_deposit_amount := 0;
    v_pending_expires_at := NULL;
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
    notes,
    pending_expires_at
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
    NULLIF(BTRIM(p_notes), ''),
    v_pending_expires_at
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
