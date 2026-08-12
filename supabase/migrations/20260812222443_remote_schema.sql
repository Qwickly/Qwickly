


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."whatsapp_session_status" AS ENUM (
    'qrcode',
    'connected',
    'disconnected'
);


ALTER TYPE "public"."whatsapp_session_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking_by_manage_token"("p_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."cancel_booking_by_manage_token"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_available_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("start_time" "text", "end_time" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."compute_available_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_booking"("p_slug" "text", "p_service_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_start_time" timestamp with time zone, "p_staff_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text", "p_client_email" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
  -- validation locals
  v_staff_id UUID;
  v_local_start TIMESTAMP;
  v_day_name TEXT;
  v_local_start_time TIME;
  v_local_end_time TIME;
  v_is_open BOOLEAN;
  v_open_time TIME;
  v_close_time TIME;
  v_has_active_staff BOOLEAN;
  v_phone TEXT;
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

  v_end_time := p_start_time + make_interval(mins => v_duration);

  -- ── Requested time must be real ──────────────────────────────────────────
  -- None of this was enforced before: the browser only ever posts a slot it got
  -- from compute_available_slots, but the RPC is callable directly by anon, so
  -- bookings in the past or outside opening hours were accepted.
  --
  -- Africa/Johannesburg matches compute_available_slots, which builds its slots
  -- as (date + time) AT TIME ZONE 'Africa/Johannesburg'. Keep the two in step.
  IF p_start_time <= now() THEN
    RAISE EXCEPTION 'Bookings must be in the future';
  END IF;

  v_local_start := p_start_time AT TIME ZONE 'Africa/Johannesburg';
  v_day_name := lower(trim(to_char(v_local_start, 'Day')));
  v_local_start_time := v_local_start::time;
  v_local_end_time := v_local_start_time + make_interval(mins => v_duration);

  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.business_operating_hours
  WHERE business_id = v_business_id AND day_name = v_day_name
  LIMIT 1;

  IF v_is_open IS NOT TRUE THEN
    RAISE EXCEPTION 'The business is closed on %', initcap(v_day_name);
  END IF;

  IF v_local_start_time < v_open_time OR v_local_end_time > v_close_time THEN
    RAISE EXCEPTION 'Requested time is outside opening hours (% to %)',
      to_char(v_open_time, 'HH24:MI'), to_char(v_close_time, 'HH24:MI');
  END IF;

  -- Validate staff if provided, including that they work that day
  v_staff_id := p_staff_id;

  IF v_staff_id IS NOT NULL THEN
    PERFORM 1
    FROM public.staff_members
    WHERE id = v_staff_id
      AND business_id = v_business_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or inactive staff member';
    END IF;

    PERFORM 1
    FROM public.staff_members
    WHERE id = v_staff_id
      AND working_days @> ARRAY[v_day_name];

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That staff member does not work on %', initcap(v_day_name);
    END IF;
  ELSE
    -- "Any staff" — resolve to a concrete free member so the booking is bound by
    -- bookings_staff_no_overlap. Leaving staff_id NULL here was what allowed
    -- unlimited bookings on one slot: the free-slot check looks for a staff
    -- member with no clashing booking, and a NULL-staff booking clashes with
    -- nobody, so every subsequent request passed too.
    SELECT sm.id
    INTO v_staff_id
    FROM public.staff_members sm
    WHERE sm.business_id = v_business_id
      AND sm.is_active = true
      AND sm.working_days @> ARRAY[v_day_name]
      AND NOT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.staff_id = sm.id
          AND b.status IN ('pending', 'confirmed')
          AND tstzrange(b.start_time, b.end_time) && tstzrange(p_start_time, v_end_time)
      )
    ORDER BY sm.id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1 FROM public.staff_members
      WHERE business_id = v_business_id AND is_active = true
    ) INTO v_has_active_staff;

    -- Businesses with no staff records at all keep staff_id NULL and are covered
    -- by bookings_no_staff_no_overlap instead.
    IF v_staff_id IS NULL AND v_has_active_staff THEN
      RAISE EXCEPTION 'No staff are available at that time';
    END IF;
  END IF;

  -- Final availability check, using the same helper the slot list uses.
  IF NOT public.public_booking_slot_is_free(
       v_business_id, v_staff_id, v_day_name, p_start_time, v_end_time
     ) THEN
    RAISE EXCEPTION 'That time is no longer available';
  END IF;

  -- Find or create client by phone within business.
  -- Normalised on both sides so "0821234567", "+27 82 123 4567" and
  -- "27821234567" all resolve to the same client instead of creating duplicates.
  v_phone := public.normalize_phone(p_client_phone);

  SELECT id
  INTO v_client_id
  FROM public.clients
  WHERE business_id = v_business_id
    AND phone = v_phone
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
      v_phone,
      NULLIF(BTRIM(p_client_email), ''),
      'new',
      'new'
    )
    RETURNING id INTO v_client_id;

    v_client_created := true;
  ELSE
    -- FILL BLANKS ONLY — never overwrite.
    --
    -- This previously did `email = COALESCE(NULLIF(BTRIM(p_client_email),''), email)`,
    -- which replaced whatever was stored. The client is matched on phone number
    -- alone, and this function is callable by anyone with the public page slug, so
    -- knowing a customer's phone number was enough to change the name and email on
    -- their record — redirecting that client's future booking confirmations and
    -- reminders to an attacker-supplied address.
    --
    -- An unauthenticated caller may now only populate fields that are empty.
    -- Changing existing details is an owner action, through an authenticated path.
    UPDATE public.clients
    SET name  = COALESCE(NULLIF(BTRIM(name), ''), NULLIF(BTRIM(p_client_name), ''), name),
        email = COALESCE(NULLIF(BTRIM(email), ''), NULLIF(BTRIM(p_client_email), ''))
    WHERE id = v_client_id;
  END IF;

  v_client_name := COALESCE(NULLIF(BTRIM(p_client_name), ''), 'Guest');

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
    v_staff_id,
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


ALTER FUNCTION "public"."create_public_booking"("p_slug" "text", "p_service_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_start_time" timestamp with time zone, "p_staff_id" "uuid", "p_notes" "text", "p_client_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_staff_seat_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sub_id        UUID;
  v_plan_meta     JSONB;
  v_plan_staff    INTEGER;
  v_extra         INTEGER;
  v_allowed       INTEGER;
  v_current       INTEGER;
BEGIN
  -- Only enforce when this row will occupy a seat:
  --   INSERT of an active staff member, or
  --   UPDATE that flips an archived member back to active.
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(NEW.is_active, true) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (COALESCE(NEW.is_active, true) AND NOT COALESCE(OLD.is_active, true)) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- The live subscription decides the allowance.
  SELECT s.id, p.metadata
    INTO v_sub_id, v_plan_meta
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.business_id = NEW.business_id
    AND s.status IN ('active', 'trialing')
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- No live subscription → fail open (see header).
  IF v_sub_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- NULL plan.staff = unlimited.
  IF v_plan_meta->'staff' IS NULL OR jsonb_typeof(v_plan_meta->'staff') = 'null' THEN
    RETURN NEW;
  END IF;
  v_plan_staff := (v_plan_meta->>'staff')::INTEGER;

  -- Purchased extra seats that are still active (not scheduled-removed and past it).
  SELECT COALESCE(SUM(sa.quantity), 0)
    INTO v_extra
  FROM public.subscription_addons sa
  WHERE sa.subscription_id = v_sub_id
    AND sa.addon_id = 'extra_staff'
    AND (sa.remove_at IS NULL OR sa.remove_at > now());

  v_allowed := v_plan_staff + COALESCE(v_extra, 0);

  -- Count seats already occupied, excluding this row (matters on UPDATE).
  SELECT COUNT(*)
    INTO v_current
  FROM public.staff_members
  WHERE business_id = NEW.business_id
    AND is_active = true
    AND id <> NEW.id;

  IF v_current >= v_allowed THEN
    RAISE EXCEPTION
      'staff_seat_limit_reached: your plan includes % bookable staff. Add an Additional Staff seat to add more.',
      v_allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_staff_seat_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_client_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_client_id" "uuid", "p_type" "text", "p_message" "text", "p_scheduled_at" timestamp with time zone, "p_send_whatsapp" boolean, "p_send_email" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF p_send_whatsapp THEN
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'whatsapp');
  END IF;

  IF p_send_email THEN
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'email');
  END IF;
END;
$$;


ALTER FUNCTION "public"."enqueue_client_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_client_id" "uuid", "p_type" "text", "p_message" "text", "p_scheduled_at" timestamp with time zone, "p_send_whatsapp" boolean, "p_send_email" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_staff_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_staff_id" "uuid", "p_type" "text", "p_message" "text", "p_send_whatsapp" boolean, "p_send_email" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM public.staff_notifications
  WHERE booking_id = p_booking_id
    AND staff_id = p_staff_id
    AND notification_type = p_type
    AND status = 'pending';

  IF p_send_whatsapp THEN
    INSERT INTO public.staff_notifications
      (business_id, booking_id, staff_id, notification_type, message, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_staff_id, p_type, p_message, 'pending', 'whatsapp');
  END IF;

  IF p_send_email THEN
    INSERT INTO public.staff_notifications
      (business_id, booking_id, staff_id, notification_type, message, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_staff_id, p_type, p_message, 'pending', 'email');
  END IF;
END;
$$;


ALTER FUNCTION "public"."enqueue_staff_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_staff_id" "uuid", "p_type" "text", "p_message" "text", "p_send_whatsapp" boolean, "p_send_email" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_my_business"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  existing_id UUID;
  new_id UUID;
  owner_name TEXT;
  owner_email TEXT;
BEGIN
  SELECT id INTO existing_id FROM public.businesses WHERE user_id = auth.uid();
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  SELECT
    COALESCE(
      NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
      split_part(email, '@', 1)
    ),
    email
  INTO owner_name, owner_email
  FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.businesses (user_id, business_name, industry, phone, email)
  VALUES (
    auth.uid(),
    COALESCE((SELECT raw_user_meta_data->>'business_name' FROM auth.users WHERE id = auth.uid()), ''),
    COALESCE((SELECT raw_user_meta_data->>'business_type' FROM auth.users WHERE id = auth.uid()), 'other'),
    COALESCE((SELECT raw_user_meta_data->>'phone' FROM auth.users WHERE id = auth.uid()), ''),
    COALESCE(owner_email, '')
  )
  RETURNING id INTO new_id;

  PERFORM public.seed_business_defaults(new_id, owner_name, owner_email);
  RETURN new_id;
END;
$$;


ALTER FUNCTION "public"."ensure_my_business"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_my_tenant"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  tenant_id UUID;
  tenant_name TEXT;
BEGIN
  SELECT id
  INTO tenant_id
  FROM public.tenants
  WHERE owner_user_id = auth.uid();

  IF tenant_id IS NOT NULL THEN
    RETURN tenant_id;
  END IF;

  SELECT COALESCE(
    NULLIF(TRIM(raw_user_meta_data->>'business_name'), ''),
    NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
    split_part(email, '@', 1),
    'Tenant'
  )
  INTO tenant_name
  FROM auth.users
  WHERE id = auth.uid();

  INSERT INTO public.tenants (owner_user_id, name)
  VALUES (auth.uid(), tenant_name)
  RETURNING id INTO tenant_id;

  RETURN tenant_id;
END;
$$;


ALTER FUNCTION "public"."ensure_my_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_booking_by_manage_token"("p_token" "uuid") RETURNS TABLE("booking_id" "uuid", "status" "text", "start_time" timestamp with time zone, "end_time" timestamp with time zone, "service_id" "uuid", "service_name" "text", "staff_id" "uuid", "staff_name" "text", "business_id" "uuid", "business_name" "text", "business_slug" "text", "client_name" "text", "can_cancel" boolean, "can_reschedule" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_booking_by_manage_token"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_booking_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("start_time" "text", "end_time" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.user_owns_business(p_business_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.compute_available_slots(p_business_id, p_service_id, p_date, p_staff_id);
END;
$$;


ALTER FUNCTION "public"."get_business_booking_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_booking_slots"("p_slug" "text", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("start_time" "text", "end_time" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_public_booking_slots"("p_slug" "text", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_source" "text", "p_reason" "text" DEFAULT NULL::"text", "p_ref_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row public.credit_balances%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  IF p_source NOT IN ('purchase', 'refund', 'adjustment') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_source');
  END IF;

  -- Materialise + LOCK the balance row before checking for a duplicate. Without
  -- the lock, two concurrent ITN retries can both pass the EXISTS check and both
  -- credit. Same pattern as spend_credits().
  INSERT INTO public.credit_balances (business_id, kind)
  VALUES (p_business_id, p_kind)
  ON CONFLICT (business_id, kind) DO NOTHING;

  SELECT * INTO v_row
  FROM public.credit_balances
  WHERE business_id = p_business_id AND kind = p_kind
  FOR UPDATE;

  -- Idempotency: a PayFast ITN legitimately arrives more than once (it retries
  -- until it gets a 200). Never credit the same reference twice.
  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE ref_id = p_ref_id AND source = p_source AND kind = p_kind
  ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'purchased_remaining', v_row.purchased
    );
  END IF;

  UPDATE public.credit_balances
  SET purchased = purchased + p_amount
  WHERE business_id = p_business_id AND kind = p_kind
  RETURNING * INTO v_row;

  INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
  VALUES (p_business_id, p_kind, p_amount, p_source, p_reason, p_ref_id, v_row.purchased);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'purchased_remaining', v_row.purchased);

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.credit_balances
    WHERE business_id = p_business_id AND kind = p_kind;
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'purchased_remaining', COALESCE(v_row.purchased, 0)
    );
END;
$$;


ALTER FUNCTION "public"."grant_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_source" "text", "p_reason" "text", "p_ref_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_business_id UUID;
  owner_name TEXT;
BEGIN
  owner_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(CONCAT(
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      ' ',
      COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    )), ''),
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.businesses (
    user_id, business_name, industry, phone, email
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'business_type', 'other'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.email, '')
  )
  RETURNING id INTO new_business_id;

  PERFORM public.seed_business_defaults(new_business_id, owner_name, COALESCE(NEW.email, ''));

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_subscription"("business_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = business_uuid
    AND status = 'active'
    AND cancel_at_period_end = false
  );
END;
$$;


ALTER FUNCTION "public"."has_active_subscription"("business_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_meta_whatsapp_connection"("p_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meta_whatsapp_connections c
    WHERE c.business_id = p_business_id
      AND public.user_owns_business(p_business_id)
  );
$$;


ALTER FUNCTION "public"."has_meta_whatsapp_connection"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manage_booking_client_notifications"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_client_email TEXT;
  v_client_status TEXT;
  v_whatsapp_ok BOOLEAN;  -- client reachable on WhatsApp (has a conversation)
  v_has_email BOOLEAN;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_settings RECORD;
  v_booking_date TEXT;
  v_booking_time TEXT;
  v_msg TEXT;
  v_wa BOOLEAN;     -- send WhatsApp for the current event
  v_em BOOLEAN;     -- send Email for the current event
BEGIN
  DELETE FROM public.client_notifications
  WHERE booking_id = NEW.id AND status = 'pending';

  IF NEW.status = 'no_show' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings
  FROM public.notification_settings
  WHERE business_id = NEW.business_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT business_name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;

  SELECT name, phone, email, status
    INTO v_client_name, v_client_phone, v_client_email, v_client_status
  FROM public.clients WHERE id = NEW.client_id;

  v_whatsapp_ok := (COALESCE(v_client_status, 'new') = 'active');
  v_has_email := (v_client_email IS NOT NULL AND v_client_email <> '');

  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;

  IF NEW.staff_id IS NOT NULL THEN
    SELECT name INTO v_staff_name FROM public.staff_members WHERE id = NEW.staff_id;
  ELSE
    v_staff_name := 'Staff';
  END IF;

  v_booking_date := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_booking_time := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- 1. Cancellation notice
  IF NEW.status = 'cancelled' THEN
    v_wa := v_settings.cancellation_notices AND v_whatsapp_ok;
    v_em := v_settings.cancellation_notices_email AND v_has_email;
    IF (v_wa OR v_em) AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status <> 'cancelled')) THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been cancelled.';
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'cancellation_notices', v_msg, now(), v_wa, v_em);
    END IF;
    RETURN NEW;
  END IF;

  -- 2. Rescheduling alert
  IF TG_OP = 'UPDATE' AND OLD.start_time <> NEW.start_time THEN
    v_wa := v_settings.rescheduling_alerts AND v_whatsapp_ok;
    v_em := v_settings.rescheduling_alerts_email AND v_has_email;
    IF v_wa OR v_em THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' has been rescheduled to ' || v_booking_date || ' at ' || v_booking_time || '.';
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'rescheduling_alerts', v_msg, now(), v_wa, v_em);
    END IF;
  END IF;

  v_msg := NULL;

  -- 3. Booking confirmation / request received
  v_wa := v_settings.booking_confirmations AND v_whatsapp_ok;
  v_em := v_settings.booking_confirmations_email AND v_has_email;
  IF v_wa OR v_em THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'confirmed' THEN
        v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been confirmed. Thank you!';
      ELSIF NEW.status = 'pending' THEN
        v_msg := 'Hi ' || v_client_name || ', your booking request for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been received and is awaiting confirmation. We''ll be in touch shortly!';
      END IF;
    ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM 'confirmed') AND NEW.status = 'confirmed' THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been confirmed. Thank you!';
    END IF;

    IF v_msg IS NOT NULL THEN
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'booking_confirmations', v_msg, now(), v_wa, v_em);
    END IF;
  END IF;

  v_msg := NULL;

  -- 4. 24-hour reminder
  v_wa := v_settings.reminder_24h AND v_whatsapp_ok;
  v_em := v_settings.reminder_24h_email AND v_has_email;
  IF (v_wa OR v_em) AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', this is a reminder for your upcoming appointment for ' || v_service_name || ' with ' || v_staff_name || ' on ' || v_booking_date || ' at ' || v_booking_time || '. See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_24h', v_msg, NEW.start_time - INTERVAL '24 hours', v_wa, v_em);
  END IF;

  -- 5. 2-hour reminder
  v_wa := v_settings.reminder_2h AND v_whatsapp_ok;
  v_em := v_settings.reminder_2h_email AND v_has_email;
  IF (v_wa OR v_em) AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', your appointment for ' || v_service_name || ' with ' || v_staff_name || ' starts in 2 hours (at ' || v_booking_time || '). See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_2h', v_msg, NEW.start_time - INTERVAL '2 hours', v_wa, v_em);
  END IF;

  -- 6. Review request
  v_wa := v_settings.review_requests AND v_whatsapp_ok;
  v_em := v_settings.review_requests_email AND v_has_email;
  IF (v_wa OR v_em) AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := 'Hi ' || v_client_name || ', thanks for visiting ' || v_business_name || ' today! How was your appointment for ' || v_service_name || '? We would love to hear your feedback!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'review_requests', v_msg, NEW.end_time + INTERVAL '2 hours', v_wa, v_em);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."manage_booking_client_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manage_booking_staff_notifications"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_client_name TEXT;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_staff_email TEXT;
  v_has_staff_email BOOLEAN;
  v_booking_date TEXT;
  v_booking_time TEXT;
  v_settings RECORD;
  v_msg TEXT;
  v_wa BOOLEAN;
  v_em BOOLEAN;
BEGIN
  SELECT * INTO v_settings
  FROM public.notification_settings
  WHERE business_id = NEW.business_id;

  IF NOT FOUND OR NEW.staff_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  SELECT name, email INTO v_staff_name, v_staff_email FROM public.staff_members WHERE id = NEW.staff_id;
  v_has_staff_email := (v_staff_email IS NOT NULL AND v_staff_email <> '');

  v_booking_date := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_booking_time := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- ── New booking assigned ──────────────────────────────────────────────────
  v_wa := v_settings.staff_new_booking;
  v_em := v_settings.staff_new_booking_email AND v_has_staff_email;
  IF (v_wa OR v_em)
     AND (TG_OP = 'INSERT'
          OR (TG_OP = 'UPDATE' AND (OLD.staff_id IS NULL OR OLD.staff_id <> NEW.staff_id))) THEN
    v_msg := 'New booking assigned to you:' || E'\n' ||
             'Client: ' || v_client_name || E'\n' ||
             'Service: ' || v_service_name || E'\n' ||
             'Date: ' || v_booking_date || E'\n' ||
             'Time: ' || v_booking_time;
    PERFORM public.enqueue_staff_notification(
      NEW.business_id, NEW.id, NEW.staff_id, 'new_booking', v_msg, v_wa, v_em);
  END IF;

  -- ── Reschedule ────────────────────────────────────────────────────────────
  v_wa := v_settings.staff_reschedule;
  v_em := v_settings.staff_reschedule_email AND v_has_staff_email;
  IF (v_wa OR v_em) AND TG_OP = 'UPDATE'
     AND OLD.start_time <> NEW.start_time AND NEW.status <> 'cancelled' THEN
    v_msg := 'Booking rescheduled:' || E'\n' ||
             'Client: ' || v_client_name || E'\n' ||
             'Service: ' || v_service_name || E'\n' ||
             'New date: ' || v_booking_date || E'\n' ||
             'New time: ' || v_booking_time;
    PERFORM public.enqueue_staff_notification(
      NEW.business_id, NEW.id, NEW.staff_id, 'reschedule', v_msg, v_wa, v_em);
  END IF;

  -- ── Cancellation ──────────────────────────────────────────────────────────
  v_wa := v_settings.staff_cancellation;
  v_em := v_settings.staff_cancellation_email AND v_has_staff_email;
  IF (v_wa OR v_em) AND TG_OP = 'UPDATE'
     AND OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    v_msg := 'Booking cancelled:' || E'\n' ||
             'Client: ' || v_client_name || E'\n' ||
             'Service: ' || v_service_name || E'\n' ||
             'Date: ' || v_booking_date || E'\n' ||
             'Time: ' || v_booking_time;
    PERFORM public.enqueue_staff_notification(
      NEW.business_id, NEW.id, NEW.staff_id, 'cancellation', v_msg, v_wa, v_em);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."manage_booking_staff_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manage_booking_whatsapp_reminders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_settings RECORD;
  v_date_str TEXT;
  v_time_str TEXT;
  v_msg TEXT;
BEGIN
  -- Always delete existing pending/scheduled reminders for this booking first
  DELETE FROM public.whatsapp_reminders
  WHERE booking_id = NEW.id AND status = 'scheduled';

  -- If the booking is cancelled or marked as no-show, do not schedule reminders
  IF NEW.status IN ('cancelled', 'no_show') THEN
    RETURN NEW;
  END IF;

  -- Load whatsapp settings for this business
  SELECT * INTO v_settings FROM public.whatsapp_settings WHERE business_id = NEW.business_id;
  IF NOT FOUND OR NOT v_settings.reminders_enabled THEN
    RETURN NEW;
  END IF;

  -- Load helper names for variable interpolation
  SELECT business_name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;
  SELECT name, phone INTO v_client_name, v_client_phone FROM public.clients WHERE id = NEW.client_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  
  IF NEW.staff_id IS NOT NULL THEN
    SELECT name INTO v_staff_name FROM public.staff_members WHERE id = NEW.staff_id;
  ELSE
    v_staff_name := 'Staff';
  END IF;

  -- Format date and time (defaulting to South Africa SAST timezone: UTC+2)
  v_date_str := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_time_str := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- 1. Schedule Booking Confirmation message (sent immediately)
  IF v_settings.confirmation_enabled AND NEW.status IN ('pending', 'confirmed') THEN
    v_msg := v_settings.confirmation_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, now(), 'confirmation', 'scheduled');
  END IF;

  -- 2. Schedule 24-Hour Reminder
  IF v_settings.reminder_24h_enabled AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := v_settings.reminder_24h_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.start_time - INTERVAL '24 hours', '24h', 'scheduled');
  END IF;

  -- 3. Schedule 2-Hour Reminder
  IF v_settings.reminder_2h_enabled AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := v_settings.reminder_2h_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.start_time - INTERVAL '2 hours', '2h', 'scheduled');
  END IF;

  -- 4. Schedule Post-Appointment Follow-up / Review request
  IF v_settings.follow_up_enabled AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := v_settings.follow_up_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.end_time + (v_settings.follow_up_hours * INTERVAL '1 hour'), 'follow_up', 'scheduled');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."manage_booking_whatsapp_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_phone"("p_phone" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  SELECT CASE
           WHEN d = ''                THEN ''
           WHEN d ~ '^0[0-9]{9}$'     THEN '27' || substring(d from 2)
           WHEN length(d) = 9         THEN '27' || d
           ELSE d
         END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) t;
$_$;


ALTER FUNCTION "public"."normalize_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_booking_by_manage_token"("p_token" "uuid", "p_new_start" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_booking       public.bookings%ROWTYPE;
  v_accept        BOOLEAN;
  v_notice_hours  INTEGER;
  v_duration      INTEGER;
  v_new_end       TIMESTAMPTZ;
  v_local_start   TIMESTAMP;
  v_day_name      TEXT;
  v_local_start_t TIME;
  v_local_end_t   TIME;
  v_is_open       BOOLEAN;
  v_open_time     TIME;
  v_close_time    TIME;
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

  -- NEW: the destination must fall inside opening hours. Africa/Johannesburg
  -- matches compute_available_slots and create_public_booking.
  v_local_start   := p_new_start AT TIME ZONE 'Africa/Johannesburg';
  v_day_name      := lower(trim(to_char(v_local_start, 'Day')));
  v_local_start_t := v_local_start::time;
  v_local_end_t   := v_local_start_t + make_interval(mins => v_duration);

  SELECT is_open, open_time, close_time
  INTO v_is_open, v_open_time, v_close_time
  FROM public.business_operating_hours
  WHERE business_id = v_booking.business_id AND day_name = v_day_name
  LIMIT 1;

  IF v_is_open IS NOT TRUE THEN
    RAISE EXCEPTION 'The business is closed on %', initcap(v_day_name);
  END IF;

  IF v_local_start_t < v_open_time OR v_local_end_t > v_close_time THEN
    RAISE EXCEPTION 'Requested time is outside opening hours (% to %)',
      to_char(v_open_time, 'HH24:MI'), to_char(v_close_time, 'HH24:MI');
  END IF;

  -- NEW: if the booking has an assigned staff member, they must work that day.
  IF v_booking.staff_id IS NOT NULL THEN
    PERFORM 1
    FROM public.staff_members
    WHERE id = v_booking.staff_id
      AND working_days @> ARRAY[v_day_name];

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That staff member does not work on %', initcap(v_day_name);
    END IF;
  END IF;

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


ALTER FUNCTION "public"."reschedule_booking_by_manage_token"("p_token" "uuid", "p_new_start" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_booking_policy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.booking_policies (business_id)
  VALUES (NEW.id)
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."seed_booking_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_bot_defaults"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  d TEXT;
  days TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
BEGIN
  -- Bot settings row
  INSERT INTO public.whatsapp_bot_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- Working hours rows (sensible defaults: Mon–Fri 08–18, Sat 08–15, Sun closed)
  FOREACH d IN ARRAY days LOOP
    INSERT INTO public.whatsapp_bot_working_hours (business_id, day_name, is_open, open_time, close_time)
    VALUES (
      p_business_id,
      d,
      CASE
        WHEN d IN ('monday','tuesday','wednesday','thursday','friday') THEN true
        WHEN d = 'saturday' THEN true
        ELSE false
      END,
      CASE WHEN d = 'sunday' THEN '09:00'::time ELSE '08:00'::time END,
      CASE
        WHEN d IN ('monday','tuesday','wednesday','thursday','friday') THEN '18:00'::time
        WHEN d = 'saturday' THEN '15:00'::time
        ELSE '13:00'::time
      END
    )
    ON CONFLICT (business_id, day_name) DO NOTHING;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."seed_bot_defaults"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_business_defaults"("p_business_id" "uuid", "p_owner_name" "text", "p_owner_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  d TEXT;
  days TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  p TEXT;
  providers TEXT[] := ARRAY['payfast','yoco','cash','eft','snapscan','ozow'];
BEGIN
  FOREACH d IN ARRAY days LOOP
    INSERT INTO public.business_operating_hours (business_id, day_name, is_open, open_time, close_time)
    VALUES (p_business_id, d, false, '08:00'::time, '18:00'::time)
    ON CONFLICT (business_id, day_name) DO NOTHING;
  END LOOP;

  INSERT INTO public.notification_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  FOREACH p IN ARRAY providers LOOP
    INSERT INTO public.payment_provider_settings (business_id, provider_key, enabled, connected)
    VALUES (p_business_id, p, false, false)
    ON CONFLICT (business_id, provider_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.deposit_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO public.whatsapp_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO public.team_members (
    business_id, name, email, role,
    perm_bookings, perm_clients, perm_payments, perm_analytics, perm_settings
  )
  VALUES (
    p_business_id, p_owner_name, p_owner_email, 'owner',
    true, true, true, true, true
  )
  ON CONFLICT (business_id, email) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."seed_business_defaults"("p_business_id" "uuid", "p_owner_name" "text", "p_owner_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."spend_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_included_limit" integer, "p_period_start" "date", "p_reason" "text" DEFAULT NULL::"text", "p_ref_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row               public.credit_balances%ROWTYPE;
  v_included_used     INTEGER;
  v_included_avail    INTEGER;
  v_from_included     INTEGER;
  v_from_purchased    INTEGER;
  v_unlimited         BOOLEAN := (p_included_limit IS NULL);
  v_period_rolled     BOOLEAN := false;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- Materialise the row, then lock it. The INSERT..DO NOTHING + SELECT FOR UPDATE
  -- pair is what makes concurrent sends safe: two workers spending at once
  -- serialise here instead of both reading the same balance and double-spending.
  INSERT INTO public.credit_balances (business_id, kind, period_start)
  VALUES (p_business_id, p_kind, COALESCE(p_period_start, CURRENT_DATE))
  ON CONFLICT (business_id, kind) DO NOTHING;

  SELECT * INTO v_row
  FROM public.credit_balances
  WHERE business_id = p_business_id AND kind = p_kind
  FOR UPDATE;

  -- Roll the included allowance over if the billing period advanced.
  IF p_period_start IS NOT NULL AND v_row.period_start < p_period_start THEN
    v_included_used := 0;
    v_period_rolled := true;
  ELSE
    v_included_used := v_row.included_used;
  END IF;

  IF v_unlimited THEN
    v_from_included  := p_amount;
    v_from_purchased := 0;
  ELSE
    v_included_avail := GREATEST(0, p_included_limit - v_included_used);
    v_from_included  := LEAST(p_amount, v_included_avail);
    v_from_purchased := p_amount - v_from_included;

    -- Not enough. Write nothing and let the caller decide what to tell the user.
    IF v_from_purchased > v_row.purchased THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'insufficient',
        'shortfall', v_from_purchased - v_row.purchased,
        'included_remaining', v_included_avail,
        'purchased_remaining', v_row.purchased
      );
    END IF;
  END IF;

  UPDATE public.credit_balances
  SET included_used = v_included_used + v_from_included,
      purchased     = purchased - v_from_purchased,
      period_start  = COALESCE(p_period_start, period_start)
  WHERE business_id = p_business_id AND kind = p_kind
  RETURNING * INTO v_row;

  IF v_period_rolled THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id)
    VALUES (p_business_id, p_kind, 0, 'period_reset',
            'included allowance reset for new billing period', NULL);
  END IF;

  -- Log the two buckets separately so usage and spend can be told apart later.
  IF v_from_included > 0 THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
    VALUES (p_business_id, p_kind, -v_from_included, 'spend_included', p_reason, p_ref_id, NULL);
  END IF;

  IF v_from_purchased > 0 THEN
    INSERT INTO public.credit_ledger (business_id, kind, delta, source, reason, ref_id, balance_after)
    VALUES (p_business_id, p_kind, -v_from_purchased, 'spend_purchased', p_reason, p_ref_id, v_row.purchased);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unlimited', v_unlimited,
    'spent_included', v_from_included,
    'spent_purchased', v_from_purchased,
    'included_used', v_row.included_used,
    'included_remaining',
      CASE WHEN v_unlimited THEN NULL
           ELSE GREATEST(0, p_included_limit - v_row.included_used) END,
    'purchased_remaining', v_row.purchased
  );
END;
$$;


ALTER FUNCTION "public"."spend_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_included_limit" integer, "p_period_start" "date", "p_reason" "text", "p_ref_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_owns_business"("p_business_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id AND b.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_owns_business"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_owns_tenant"("p_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.owner_user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_owns_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ab_test_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ab_test_id" "uuid" NOT NULL,
    "recipient_phone" "text" NOT NULL,
    "variant" "text" NOT NULL,
    "sent_at" timestamp with time zone NOT NULL,
    "opened_at" timestamp with time zone,
    "responded_at" timestamp with time zone,
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ab_test_assignments_variant_check" CHECK (("variant" = ANY (ARRAY['A'::"text", 'B'::"text"])))
);


ALTER TABLE "public"."ab_test_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ab_tests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "campaign_id" "uuid",
    "name" "text" NOT NULL,
    "message_a" "text" NOT NULL,
    "message_b" "text" NOT NULL,
    "image_url_a" "text",
    "image_url_b" "text",
    "split_percentage" integer DEFAULT 50,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "winner" "text",
    "statistical_significance" numeric(5,4),
    "sample_size_a" integer DEFAULT 0,
    "sample_size_b" integer DEFAULT 0,
    "conversions_a" integer DEFAULT 0,
    "conversions_b" integer DEFAULT 0,
    "opens_a" integer DEFAULT 0,
    "opens_b" integer DEFAULT 0,
    "responses_a" integer DEFAULT 0,
    "responses_b" integer DEFAULT 0,
    "conversion_rate_a" numeric(5,4),
    "conversion_rate_b" numeric(5,4),
    "open_rate_a" numeric(5,4),
    "open_rate_b" numeric(5,4),
    "response_rate_a" numeric(5,4),
    "response_rate_b" numeric(5,4),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ab_tests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "ab_tests_winner_check" CHECK (("winner" = ANY (ARRAY['A'::"text", 'B'::"text", 'tie'::"text", 'inconclusive'::"text"])))
);


ALTER TABLE "public"."ab_tests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "actor_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "actor_id" "text",
    "entity_type" "text" NOT NULL,
    "entity_id" "text",
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_events_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['user'::"text", 'ai'::"text", 'system'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blacklisted_numbers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "phone" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "blacklisted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."blacklisted_numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_page_settings" (
    "business_id" "uuid" NOT NULL,
    "page_title" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "welcome_message" "text" DEFAULT ''::"text" NOT NULL,
    "slug" "text" NOT NULL,
    "require_deposit" boolean DEFAULT false NOT NULL,
    "allow_rescheduling" boolean DEFAULT true NOT NULL,
    "show_staff_selection" boolean DEFAULT true NOT NULL,
    "show_prices" boolean DEFAULT true NOT NULL,
    "show_duration" boolean DEFAULT true NOT NULL,
    "cover_image_url" "text",
    "logo_url" "text",
    "primary_color" "text" DEFAULT '#10b981'::"text" NOT NULL,
    "secondary_color" "text" DEFAULT '#059669'::"text" NOT NULL,
    "layout" "text" DEFAULT 'classic'::"text" NOT NULL,
    "font_family" "text" DEFAULT 'inter'::"text" NOT NULL,
    "border_radius" "text" DEFAULT 'md'::"text" NOT NULL,
    "header_style" "text" DEFAULT 'banner'::"text" NOT NULL,
    "button_style" "text" DEFAULT 'filled'::"text" NOT NULL,
    "background_style" "text" DEFAULT 'gradient'::"text" NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "theme_mode" "text" DEFAULT 'auto'::"text" NOT NULL,
    "page_width" "text" DEFAULT 'auto'::"text" NOT NULL,
    "show_notes" boolean DEFAULT true NOT NULL,
    "progress_style" "text" DEFAULT 'line'::"text" NOT NULL,
    "logo_style" "text" DEFAULT 'solid'::"text" NOT NULL,
    "contact_phone" "text",
    "contact_email" "text",
    "website_url" "text",
    "instagram_url" "text",
    "facebook_url" "text",
    "whatsapp_number" "text",
    CONSTRAINT "booking_page_settings_background_style_check" CHECK (("background_style" = ANY (ARRAY['solid'::"text", 'gradient'::"text", 'image'::"text"]))),
    CONSTRAINT "booking_page_settings_border_radius_check" CHECK (("border_radius" = ANY (ARRAY['none'::"text", 'sm'::"text", 'md'::"text", 'lg'::"text", 'full'::"text"]))),
    CONSTRAINT "booking_page_settings_button_style_check" CHECK (("button_style" = ANY (ARRAY['filled'::"text", 'outline'::"text", 'soft'::"text"]))),
    CONSTRAINT "booking_page_settings_font_family_check" CHECK (("font_family" = ANY (ARRAY['inter'::"text", 'serif'::"text", 'rounded'::"text", 'mono'::"text"]))),
    CONSTRAINT "booking_page_settings_header_style_check" CHECK (("header_style" = ANY (ARRAY['banner'::"text", 'compact'::"text", 'centered'::"text"]))),
    CONSTRAINT "booking_page_settings_layout_check" CHECK (("layout" = ANY (ARRAY['classic'::"text", 'minimal'::"text", 'cards'::"text", 'split'::"text"]))),
    CONSTRAINT "booking_page_settings_logo_style_check" CHECK (("logo_style" = ANY (ARRAY['solid'::"text", 'glass'::"text", 'dark'::"text", 'transparent'::"text"]))),
    CONSTRAINT "booking_page_settings_page_width_check" CHECK (("page_width" = ANY (ARRAY['auto'::"text", 'compact'::"text"]))),
    CONSTRAINT "booking_page_settings_progress_style_check" CHECK (("progress_style" = ANY (ARRAY['line'::"text", 'tiles'::"text", 'minimal'::"text"]))),
    CONSTRAINT "booking_page_settings_theme_mode_check" CHECK (("theme_mode" = ANY (ARRAY['auto'::"text", 'light'::"text", 'dark'::"text"])))
);


ALTER TABLE "public"."booking_page_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_policies" (
    "business_id" "uuid" NOT NULL,
    "accept_cancellations" boolean DEFAULT true NOT NULL,
    "cancellation_min_notice_hours" integer DEFAULT 24 NOT NULL,
    "cancellation_decline_message" "text" DEFAULT ''::"text" NOT NULL,
    "accept_reschedules" boolean DEFAULT true NOT NULL,
    "reschedule_min_notice_hours" integer DEFAULT 24 NOT NULL,
    "reschedule_decline_message" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_policies_cancellation_min_notice_hours_check" CHECK (("cancellation_min_notice_hours" >= 0)),
    CONSTRAINT "booking_policies_reschedule_min_notice_hours_check" CHECK (("reschedule_min_notice_hours" >= 0))
);


ALTER TABLE "public"."booking_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "service_id" "uuid" NOT NULL,
    "staff_id" "uuid",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "deposit_paid" boolean DEFAULT false NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "manage_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pending_expires_at" timestamp with time zone,
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'pending'::"text", 'cancelled'::"text", 'completed'::"text", 'no_show'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_operating_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "day_name" "text" NOT NULL,
    "is_open" boolean DEFAULT false NOT NULL,
    "open_time" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "close_time" time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    CONSTRAINT "business_operating_hours_day_name_check" CHECK (("day_name" = ANY (ARRAY['monday'::"text", 'tuesday'::"text", 'wednesday'::"text", 'thursday'::"text", 'friday'::"text", 'saturday'::"text", 'sunday'::"text"])))
);


ALTER TABLE "public"."business_operating_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_name" "text" DEFAULT ''::"text" NOT NULL,
    "industry" "text" DEFAULT 'other'::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "website_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "onboarding_tabs_visited" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "trial_used_at" timestamp with time zone,
    "getting_started_dismissed_steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."businesses"."trial_used_at" IS 'When this business first started its free trial. Once set, no further trials are granted — re-subscribing bills immediately.';



CREATE TABLE IF NOT EXISTS "public"."client_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "scheduled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "channel" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    CONSTRAINT "client_notifications_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'email'::"text"]))),
    CONSTRAINT "client_notifications_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['booking_confirmations'::"text", 'reminder_24h'::"text", 'reminder_2h'::"text", 'review_requests'::"text", 'cancellation_notices'::"text", 'rescheduling_alerts'::"text"]))),
    CONSTRAINT "client_notifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text",
    "client_type" "text" DEFAULT 'new'::"text" NOT NULL,
    "no_show_count" integer DEFAULT 0 NOT NULL,
    "avatar_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lid" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "clients_client_type_check" CHECK (("client_type" = ANY (ARRAY['new'::"text", 'returning'::"text", 'vip'::"text"]))),
    CONSTRAINT "clients_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'active'::"text", 'inactive'::"text", 'archived'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "business_name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "business_type" "text" DEFAULT ''::"text" NOT NULL,
    "help_with" "text" DEFAULT ''::"text" NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_submissions_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'read'::"text", 'replied'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."contact_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_balances" (
    "business_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "purchased" integer DEFAULT 0 NOT NULL,
    "included_used" integer DEFAULT 0 NOT NULL,
    "period_start" "date" DEFAULT CURRENT_DATE NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_balances_included_used_check" CHECK (("included_used" >= 0)),
    CONSTRAINT "credit_balances_kind_check" CHECK (("kind" = ANY (ARRAY['whatsapp_tokens'::"text", 'marketing_emails'::"text"]))),
    CONSTRAINT "credit_balances_purchased_check" CHECK (("purchased" >= 0))
);


ALTER TABLE "public"."credit_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_bundles" (
    "id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "amount" integer NOT NULL,
    "price_cents" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_bundles_amount_check" CHECK (("amount" > 0)),
    CONSTRAINT "credit_bundles_kind_check" CHECK (("kind" = ANY (ARRAY['whatsapp_tokens'::"text", 'marketing_emails'::"text"]))),
    CONSTRAINT "credit_bundles_price_cents_check" CHECK (("price_cents" > 0))
);


ALTER TABLE "public"."credit_bundles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "delta" integer NOT NULL,
    "source" "text" NOT NULL,
    "reason" "text",
    "ref_id" "text",
    "balance_after" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_ledger_kind_check" CHECK (("kind" = ANY (ARRAY['whatsapp_tokens'::"text", 'marketing_emails'::"text"]))),
    CONSTRAINT "credit_ledger_source_check" CHECK (("source" = ANY (ARRAY['purchase'::"text", 'spend_included'::"text", 'spend_purchased'::"text", 'refund'::"text", 'adjustment'::"text", 'period_reset'::"text"])))
);


ALTER TABLE "public"."credit_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deposit_settings" (
    "business_id" "uuid" NOT NULL,
    "require_deposit" boolean DEFAULT false NOT NULL,
    "deposit_type" "text" DEFAULT 'percentage'::"text" NOT NULL,
    "deposit_amount" numeric(10,2) DEFAULT 30 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deposit_settings_deposit_type_check" CHECK (("deposit_type" = ANY (ARRAY['percentage'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."deposit_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "sendgrid_domain_id" bigint,
    "dns_records" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "from_local_part" "text" DEFAULT 'bookings'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "last_error" "text",
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_domains_from_local_part_check" CHECK ((("from_local_part" <> ''::"text") AND ("from_local_part" !~ '[@[:space:]]'::"text"))),
    CONSTRAINT "email_domains_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."email_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "whatsapp_session_id" "uuid",
    "instance_id" "text" NOT NULL,
    "message_id" "text",
    "remote_jid" "text" NOT NULL,
    "sender_name" "text",
    "message_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "text_body" "text" DEFAULT ''::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inbound_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "subscription_id" "uuid",
    "invoice_number" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'ZAR'::"text" NOT NULL,
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "payment_method" "text" DEFAULT 'payfast'::"text" NOT NULL,
    "payment_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_date" timestamp with time zone,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['paid'::"text", 'pending'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_campaign_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "recipient_text" "text" NOT NULL,
    "recipient_type" "text" DEFAULT 'email'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "scheduled_for" "date",
    "sent_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "marketing_campaign_recipients_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['email'::"text", 'phone'::"text"]))),
    CONSTRAINT "marketing_campaign_recipients_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'queued'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."marketing_campaign_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "image_url" "text",
    "recipient_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recipient_count" integer DEFAULT 0 NOT NULL,
    "sent" integer DEFAULT 0 NOT NULL,
    "opened" integer DEFAULT 0 NOT NULL,
    "conversions" integer DEFAULT 0 NOT NULL,
    "revenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content_type" "text" DEFAULT 'text'::"text" NOT NULL,
    CONSTRAINT "marketing_campaigns_channel_check" CHECK (("channel" = ANY (ARRAY['WhatsApp'::"text", 'Email'::"text", 'SMS'::"text"]))),
    CONSTRAINT "marketing_campaigns_content_type_check" CHECK (("content_type" = ANY (ARRAY['text'::"text", 'html'::"text"]))),
    CONSTRAINT "marketing_campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'halted_no_credits'::"text"])))
);


ALTER TABLE "public"."marketing_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_engagement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "campaign_id" "uuid",
    "scheduled_campaign_id" "uuid",
    "recipient_phone" "text" NOT NULL,
    "recipient_name" "text",
    "message_id" "text",
    "sent_at" timestamp with time zone NOT NULL,
    "opened_at" timestamp with time zone,
    "responded_at" timestamp with time zone,
    "response_time_seconds" integer,
    "response_text" "text",
    "converted" boolean DEFAULT false,
    "converted_at" timestamp with time zone,
    "conversion_value" numeric(10,2),
    "timezone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."message_engagement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_whatsapp_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "access_token" "text" NOT NULL,
    "whatsapp_business_account_id" "text" NOT NULL,
    "meta_app_id" "text",
    "embedded_signup_config_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_number_id" "text"
);


ALTER TABLE "public"."meta_whatsapp_connections" OWNER TO "postgres";


COMMENT ON COLUMN "public"."meta_whatsapp_connections"."phone_number_id" IS 'Phone number ID for Meta WhatsApp Cloud API sends, saved from the manual connection form.';



CREATE TABLE IF NOT EXISTS "public"."meta_whatsapp_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "phone_number_id" "text",
    "to_phone" "text",
    "message_id" "text",
    "success" boolean,
    "response_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."meta_whatsapp_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_send_state" (
    "business_id" "uuid" NOT NULL,
    "consecutive_failures" integer DEFAULT 0 NOT NULL,
    "paused_until" timestamp with time zone,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_send_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_settings" (
    "business_id" "uuid" NOT NULL,
    "booking_confirmations" boolean DEFAULT false NOT NULL,
    "reminder_24h" boolean DEFAULT false NOT NULL,
    "reminder_2h" boolean DEFAULT false NOT NULL,
    "review_requests" boolean DEFAULT false NOT NULL,
    "cancellation_notices" boolean DEFAULT false NOT NULL,
    "rescheduling_alerts" boolean DEFAULT false NOT NULL,
    "staff_new_booking" boolean DEFAULT false NOT NULL,
    "staff_cancellation" boolean DEFAULT false NOT NULL,
    "staff_daily_summary" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_reschedule" boolean DEFAULT false NOT NULL,
    "email_enabled" boolean DEFAULT false NOT NULL,
    "booking_confirmations_email" boolean DEFAULT false NOT NULL,
    "reminder_24h_email" boolean DEFAULT false NOT NULL,
    "reminder_2h_email" boolean DEFAULT false NOT NULL,
    "review_requests_email" boolean DEFAULT false NOT NULL,
    "cancellation_notices_email" boolean DEFAULT false NOT NULL,
    "rescheduling_alerts_email" boolean DEFAULT false NOT NULL,
    "staff_new_booking_email" boolean DEFAULT false NOT NULL,
    "staff_reschedule_email" boolean DEFAULT false NOT NULL,
    "staff_cancellation_email" boolean DEFAULT false NOT NULL,
    "staff_daily_summary_email" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."notification_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."number_warmup" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "day_number" integer NOT NULL,
    "messages_sent" integer DEFAULT 0,
    "messages_successful" integer DEFAULT 0,
    "messages_failed" integer DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "number_warmup_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."number_warmup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_approval_alert_state" (
    "business_id" "uuid" NOT NULL,
    "last_pinged_at" timestamp with time zone,
    "last_pinged_count" integer DEFAULT 0 NOT NULL,
    "pings_today" integer DEFAULT 0 NOT NULL,
    "pings_day" "date",
    "snoozed_until" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."owner_approval_alert_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_provider_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'payfast'::"text" NOT NULL,
    "merchant_id" "text",
    "merchant_key" "text",
    "passphrase" "text",
    "mode" "text" DEFAULT 'sandbox'::"text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "connected" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_provider_credentials_mode_check" CHECK (("mode" = ANY (ARRAY['sandbox'::"text", 'live'::"text"]))),
    CONSTRAINT "payment_provider_credentials_provider_check" CHECK (("provider" = 'payfast'::"text"))
);


ALTER TABLE "public"."payment_provider_credentials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_provider_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "connected" boolean DEFAULT false NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_provider_settings_provider_key_check" CHECK (("provider_key" = ANY (ARRAY['payfast'::"text", 'yoco'::"text", 'cash'::"text", 'eft'::"text", 'snapscan'::"text", 'ozow'::"text"])))
);


ALTER TABLE "public"."payment_provider_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "booking_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "method" "text" DEFAULT 'cash'::"text" NOT NULL,
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "type" "text" DEFAULT 'full_payment'::"text" NOT NULL,
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_reference" "text",
    "provider_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "payments_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['payfast'::"text", 'yoco'::"text", 'cash'::"text", 'eft'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'pending'::"text", 'refunded'::"text", 'failed'::"text"]))),
    CONSTRAINT "payments_type_check" CHECK (("type" = ANY (ARRAY['deposit'::"text", 'full_payment'::"text", 'refund'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_addons" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    "max_quantity" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "public" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plan_addons_max_quantity_check" CHECK (("max_quantity" >= 1)),
    CONSTRAINT "plan_addons_price_cents_check" CHECK (("price_cents" >= 0))
);


ALTER TABLE "public"."plan_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plans" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    "billing_interval" "text" NOT NULL,
    "interval_count" integer DEFAULT 1 NOT NULL,
    "trial_days" integer DEFAULT 0,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    "interval" "text",
    "features" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "public" boolean DEFAULT true NOT NULL,
    CONSTRAINT "plans_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['month'::"text", 'year'::"text"])))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_whatsapp_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'approval_alert'::"text" NOT NULL,
    "to_phone" "text" NOT NULL,
    "message" "text" NOT NULL,
    "template_name" "text",
    "template_params" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "channel" "text" DEFAULT 'cloud_api'::"text" NOT NULL,
    "provider_message_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "error_message" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "platform_whatsapp_notifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."platform_whatsapp_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipient_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "recipient_phone" "text" NOT NULL,
    "recipient_name" "text",
    "total_messages_sent" integer DEFAULT 0,
    "total_messages_opened" integer DEFAULT 0,
    "total_responses" integer DEFAULT 0,
    "total_conversions" integer DEFAULT 0,
    "total_conversion_value" numeric(10,2) DEFAULT 0,
    "avg_response_time_seconds" integer,
    "best_send_hour" integer,
    "best_send_day" "text",
    "engagement_score" numeric(3,2) DEFAULT 0,
    "last_contacted_at" timestamp with time zone,
    "last_responded_at" timestamp with time zone,
    "timezone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recipient_insights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "campaign_id" "uuid",
    "scheduled_for" timestamp with time zone NOT NULL,
    "timezone" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "scheduled_campaigns_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."scheduled_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "duration" integer DEFAULT 60 NOT NULL,
    "color" "text" DEFAULT '#10b981'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "deposit_required" boolean DEFAULT false NOT NULL,
    "deposit_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bookable_by_bot" boolean DEFAULT true NOT NULL,
    "icon" "text" DEFAULT 'scissors'::"text" NOT NULL,
    CONSTRAINT "services_duration_check" CHECK (("duration" >= 5))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_daily_summary_log" (
    "business_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "summary_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_daily_summary_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "position" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text",
    "phone" "text",
    "avatar_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "working_days" "text"[] DEFAULT ARRAY['monday'::"text", 'tuesday'::"text", 'wednesday'::"text", 'thursday'::"text", 'friday'::"text"] NOT NULL
);


ALTER TABLE "public"."staff_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "staff_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "scheduled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "channel" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    CONSTRAINT "staff_notifications_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'email'::"text"]))),
    CONSTRAINT "staff_notifications_notification_type_check" CHECK (("notification_type" = ANY (ARRAY['new_booking'::"text", 'cancellation'::"text", 'reschedule'::"text", 'daily_summary'::"text"]))),
    CONSTRAINT "staff_notifications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."staff_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_addon_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "addon_id" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "amount_cents" integer NOT NULL,
    "days_remaining" integer NOT NULL,
    "days_in_period" integer NOT NULL,
    "payment_ref" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "subscription_addon_purchases_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "subscription_addon_purchases_quantity_check" CHECK (("quantity" >= 1)),
    CONSTRAINT "subscription_addon_purchases_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."subscription_addon_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_addons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "addon_id" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "remove_at" timestamp with time zone,
    CONSTRAINT "subscription_addons_quantity_check" CHECK (("quantity" >= 1))
);


ALTER TABLE "public"."subscription_addons" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subscription_addons"."remove_at" IS 'When set, the add-on was cancelled but is paid through this timestamp. Entitlements remain until then; the recurring amount already excludes it.';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "plan_id" "text" NOT NULL,
    "status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "payfast_token" "text",
    "current_period_start" timestamp with time zone NOT NULL,
    "current_period_end" timestamp with time zone NOT NULL,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "pending_plan_id" "text",
    "pending_cancel_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'canceled'::"text", 'incomplete'::"text", 'trialing'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "perm_bookings" boolean DEFAULT true NOT NULL,
    "perm_clients" boolean DEFAULT false NOT NULL,
    "perm_payments" boolean DEFAULT false NOT NULL,
    "perm_analytics" boolean DEFAULT false NOT NULL,
    "perm_settings" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usage_tracking" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "subscription_id" "uuid",
    "tracking_date" "date" NOT NULL,
    "marketing_messages_sent" integer DEFAULT 0 NOT NULL,
    "whatsapp_messages_sent" integer DEFAULT 0 NOT NULL,
    "whatsapp_campaigns_sent" integer DEFAULT 0 NOT NULL,
    "bookings_created" integer DEFAULT 0 NOT NULL,
    "bookings_completed" integer DEFAULT 0 NOT NULL,
    "bookings_cancelled" integer DEFAULT 0 NOT NULL,
    "clients_added" integer DEFAULT 0 NOT NULL,
    "review_requests_sent" integer DEFAULT 0 NOT NULL,
    "reviews_received" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usage_tracking" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warmup_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "is_enabled" boolean DEFAULT false,
    "current_day" integer DEFAULT 0,
    "warm_up_started_at" timestamp with time zone,
    "warm_up_completed_at" timestamp with time zone,
    "daily_targets" "jsonb" DEFAULT '{"day1": 5, "day2": 10, "day3": 20, "day4": 40, "day5": 80, "day6": 100}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."warmup_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_ai_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "inbound_message_id" "uuid",
    "remote_jid" "text" NOT NULL,
    "client_id" "uuid",
    "client_name" "text",
    "client_phone" "text",
    "inbound_message_text" "text" NOT NULL,
    "suggested_reply" "text" NOT NULL,
    "decision_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "proposed_actions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_ai_drafts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'dismissed'::"text", 'sent'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."whatsapp_ai_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_bot_faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "question" "text" DEFAULT ''::"text" NOT NULL,
    "answer" "text" DEFAULT ''::"text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_bot_faqs_answer_check" CHECK (("char_length"("answer") <= 600)),
    CONSTRAINT "whatsapp_bot_faqs_question_check" CHECK (("char_length"("question") <= 200))
);


ALTER TABLE "public"."whatsapp_bot_faqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_bot_settings" (
    "business_id" "uuid" NOT NULL,
    "bot_enabled" boolean DEFAULT true NOT NULL,
    "auto_confirm" boolean DEFAULT false NOT NULL,
    "send_payment_links" boolean DEFAULT true NOT NULL,
    "answer_faqs" boolean DEFAULT true NOT NULL,
    "always_on" boolean DEFAULT false NOT NULL,
    "tone" "text" DEFAULT 'friendly'::"text" NOT NULL,
    "bot_name" "text" DEFAULT 'Bookza Assistant'::"text" NOT NULL,
    "welcome_message" "text" DEFAULT 'Hi! 👋 How can I help you today?'::"text" NOT NULL,
    "fallback_message" "text" DEFAULT 'I''ll pass you to a human who can help. Please hold! 🙏'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_mode" "text" DEFAULT 'auto'::"text" NOT NULL,
    "owner_review_alerts_enabled" boolean DEFAULT true NOT NULL,
    "owner_alert_phone" "text",
    "owner_alert_quiet_start" time without time zone DEFAULT '21:00:00'::time without time zone NOT NULL,
    "owner_alert_quiet_end" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    CONSTRAINT "whatsapp_bot_settings_review_mode_check" CHECK (("review_mode" = ANY (ARRAY['auto'::"text", 'draft_only'::"text", 'approval_required'::"text"]))),
    CONSTRAINT "whatsapp_bot_settings_tone_check" CHECK (("tone" = ANY (ARRAY['friendly'::"text", 'professional'::"text", 'casual'::"text", 'concise'::"text"])))
);


ALTER TABLE "public"."whatsapp_bot_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_bot_working_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "day_name" "text" NOT NULL,
    "is_open" boolean DEFAULT true NOT NULL,
    "open_time" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "close_time" time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    CONSTRAINT "whatsapp_bot_working_hours_day_name_check" CHECK (("day_name" = ANY (ARRAY['monday'::"text", 'tuesday'::"text", 'wednesday'::"text", 'thursday'::"text", 'friday'::"text", 'saturday'::"text", 'sunday'::"text"])))
);


ALTER TABLE "public"."whatsapp_bot_working_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_reminders_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['confirmation'::"text", '24h'::"text", '2h'::"text", 'follow_up'::"text"]))),
    CONSTRAINT "whatsapp_reminders_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."whatsapp_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_session_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "text" NOT NULL,
    "session_archive" "text" NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_session_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "instance_id" "text" NOT NULL,
    "instance_token" "text" NOT NULL,
    "status" "public"."whatsapp_session_status" DEFAULT 'disconnected'::"public"."whatsapp_session_status" NOT NULL,
    "qr_code" "text",
    "connected_phone" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."whatsapp_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_settings" (
    "business_id" "uuid" NOT NULL,
    "phone_number" "text" DEFAULT ''::"text" NOT NULL,
    "api_token" "text" DEFAULT ''::"text" NOT NULL,
    "is_connected" boolean DEFAULT false NOT NULL,
    "reminder_lead_hours" integer DEFAULT 24 NOT NULL,
    "reply_hours_mode" "text" DEFAULT '8-18'::"text" NOT NULL,
    "include_service_name" boolean DEFAULT false NOT NULL,
    "include_staff_name" boolean DEFAULT false NOT NULL,
    "send_confirmation_immediately" boolean DEFAULT false NOT NULL,
    "allow_cancel_via_whatsapp" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminders_enabled" boolean DEFAULT true NOT NULL,
    "reminder_24h_enabled" boolean DEFAULT true NOT NULL,
    "reminder_24h_template" "text" DEFAULT 'Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!'::"text" NOT NULL,
    "reminder_2h_enabled" boolean DEFAULT false NOT NULL,
    "reminder_2h_template" "text" DEFAULT 'Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!'::"text" NOT NULL,
    "confirmation_enabled" boolean DEFAULT true NOT NULL,
    "confirmation_template" "text" DEFAULT 'Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!'::"text" NOT NULL,
    "follow_up_enabled" boolean DEFAULT false NOT NULL,
    "follow_up_hours" integer DEFAULT 2 NOT NULL,
    "follow_up_template" "text" DEFAULT 'Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!'::"text" NOT NULL,
    CONSTRAINT "whatsapp_settings_reminder_lead_hours_check" CHECK (("reminder_lead_hours" = ANY (ARRAY[2, 12, 24, 48]))),
    CONSTRAINT "whatsapp_settings_reply_hours_mode_check" CHECK (("reply_hours_mode" = ANY (ARRAY['8-18'::"text", '7-20'::"text", '24'::"text"])))
);


ALTER TABLE "public"."whatsapp_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ab_test_assignments"
    ADD CONSTRAINT "ab_test_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ab_tests"
    ADD CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blacklisted_numbers"
    ADD CONSTRAINT "blacklisted_numbers_business_id_phone_key" UNIQUE ("business_id", "phone");



ALTER TABLE ONLY "public"."blacklisted_numbers"
    ADD CONSTRAINT "blacklisted_numbers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_page_settings"
    ADD CONSTRAINT "booking_page_settings_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."booking_page_settings"
    ADD CONSTRAINT "booking_page_settings_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."booking_policies"
    ADD CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_no_staff_no_overlap" EXCLUDE USING "gist" ("business_id" WITH =, "tstzrange"("start_time", "end_time") WITH &&) WHERE ((("staff_id" IS NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"]))));



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_staff_no_overlap" EXCLUDE USING "gist" ("staff_id" WITH =, "tstzrange"("start_time", "end_time") WITH &&) WHERE ((("staff_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text"]))));



ALTER TABLE ONLY "public"."business_operating_hours"
    ADD CONSTRAINT "business_operating_hours_business_id_day_name_key" UNIQUE ("business_id", "day_name");



ALTER TABLE ONLY "public"."business_operating_hours"
    ADD CONSTRAINT "business_operating_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."client_notifications"
    ADD CONSTRAINT "client_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_submissions"
    ADD CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_balances"
    ADD CONSTRAINT "credit_balances_pkey" PRIMARY KEY ("business_id", "kind");



ALTER TABLE ONLY "public"."credit_bundles"
    ADD CONSTRAINT "credit_bundles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_ledger"
    ADD CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deposit_settings"
    ADD CONSTRAINT "deposit_settings_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."email_domains"
    ADD CONSTRAINT "email_domains_business_id_domain_key" UNIQUE ("business_id", "domain");



ALTER TABLE ONLY "public"."email_domains"
    ADD CONSTRAINT "email_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_messages"
    ADD CONSTRAINT "inbound_messages_message_id_unique" UNIQUE NULLS NOT DISTINCT ("message_id");



ALTER TABLE ONLY "public"."inbound_messages"
    ADD CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_campaign_recipients"
    ADD CONSTRAINT "marketing_campaign_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_engagement"
    ADD CONSTRAINT "message_engagement_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_whatsapp_connections"
    ADD CONSTRAINT "meta_whatsapp_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_whatsapp_messages"
    ADD CONSTRAINT "meta_whatsapp_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_send_state"
    ADD CONSTRAINT "notification_send_state_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."number_warmup"
    ADD CONSTRAINT "number_warmup_business_id_tenant_id_day_number_key" UNIQUE ("business_id", "tenant_id", "day_number");



ALTER TABLE ONLY "public"."number_warmup"
    ADD CONSTRAINT "number_warmup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."owner_approval_alert_state"
    ADD CONSTRAINT "owner_approval_alert_state_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."payment_provider_credentials"
    ADD CONSTRAINT "payment_provider_credentials_business_id_key" UNIQUE ("business_id");



ALTER TABLE ONLY "public"."payment_provider_credentials"
    ADD CONSTRAINT "payment_provider_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_provider_settings"
    ADD CONSTRAINT "payment_provider_settings_business_id_provider_key_key" UNIQUE ("business_id", "provider_key");



ALTER TABLE ONLY "public"."payment_provider_settings"
    ADD CONSTRAINT "payment_provider_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_addons"
    ADD CONSTRAINT "plan_addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_whatsapp_notifications"
    ADD CONSTRAINT "platform_whatsapp_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipient_insights"
    ADD CONSTRAINT "recipient_insights_business_id_recipient_phone_key" UNIQUE ("business_id", "recipient_phone");



ALTER TABLE ONLY "public"."recipient_insights"
    ADD CONSTRAINT "recipient_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_campaigns"
    ADD CONSTRAINT "scheduled_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_daily_summary_log"
    ADD CONSTRAINT "staff_daily_summary_log_pkey" PRIMARY KEY ("staff_id", "summary_date");



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_notifications"
    ADD CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_addon_purchases"
    ADD CONSTRAINT "subscription_addon_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_addon_purchases"
    ADD CONSTRAINT "subscription_addon_purchases_ref_addon_key" UNIQUE ("payment_ref", "addon_id");



ALTER TABLE ONLY "public"."subscription_addons"
    ADD CONSTRAINT "subscription_addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_addons"
    ADD CONSTRAINT "subscription_addons_subscription_id_addon_id_key" UNIQUE ("subscription_id", "addon_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_business_id_email_key" UNIQUE ("business_id", "email");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_owner_user_id_key" UNIQUE ("owner_user_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usage_tracking"
    ADD CONSTRAINT "usage_tracking_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warmup_config"
    ADD CONSTRAINT "warmup_config_business_id_tenant_id_key" UNIQUE ("business_id", "tenant_id");



ALTER TABLE ONLY "public"."warmup_config"
    ADD CONSTRAINT "warmup_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_bot_faqs"
    ADD CONSTRAINT "whatsapp_bot_faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_bot_settings"
    ADD CONSTRAINT "whatsapp_bot_settings_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."whatsapp_bot_working_hours"
    ADD CONSTRAINT "whatsapp_bot_working_hours_business_id_day_name_key" UNIQUE ("business_id", "day_name");



ALTER TABLE ONLY "public"."whatsapp_bot_working_hours"
    ADD CONSTRAINT "whatsapp_bot_working_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_reminders"
    ADD CONSTRAINT "whatsapp_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_session_data"
    ADD CONSTRAINT "whatsapp_session_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_session_data"
    ADD CONSTRAINT "whatsapp_session_data_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_instance_id_key" UNIQUE ("instance_id");



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."whatsapp_settings"
    ADD CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("business_id");



CREATE INDEX "ab_test_assignments_ab_test_id_idx" ON "public"."ab_test_assignments" USING "btree" ("ab_test_id");



CREATE INDEX "ab_test_assignments_recipient_phone_idx" ON "public"."ab_test_assignments" USING "btree" ("recipient_phone");



CREATE INDEX "ab_tests_business_id_idx" ON "public"."ab_tests" USING "btree" ("business_id");



CREATE INDEX "ab_tests_campaign_id_idx" ON "public"."ab_tests" USING "btree" ("campaign_id");



CREATE INDEX "ab_tests_status_idx" ON "public"."ab_tests" USING "btree" ("status");



CREATE INDEX "activity_events_business_created_idx" ON "public"."activity_events" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "activity_events_business_read_idx" ON "public"."activity_events" USING "btree" ("business_id", "read_at", "created_at" DESC);



CREATE INDEX "activity_events_entity_idx" ON "public"."activity_events" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "blacklisted_numbers_blacklisted_at_idx" ON "public"."blacklisted_numbers" USING "btree" ("blacklisted_at");



CREATE INDEX "blacklisted_numbers_business_id_idx" ON "public"."blacklisted_numbers" USING "btree" ("business_id");



CREATE INDEX "blacklisted_numbers_phone_idx" ON "public"."blacklisted_numbers" USING "btree" ("phone");



CREATE INDEX "booking_page_settings_slug_idx" ON "public"."booking_page_settings" USING "btree" ("slug");



CREATE INDEX "bookings_business_id_idx" ON "public"."bookings" USING "btree" ("business_id");



CREATE INDEX "bookings_client_id_idx" ON "public"."bookings" USING "btree" ("client_id");



CREATE UNIQUE INDEX "bookings_manage_token_idx" ON "public"."bookings" USING "btree" ("manage_token");



CREATE INDEX "bookings_pending_expiry_idx" ON "public"."bookings" USING "btree" ("pending_expires_at") WHERE (("status" = 'pending'::"text") AND ("deposit_paid" = false));



CREATE INDEX "bookings_start_time_idx" ON "public"."bookings" USING "btree" ("start_time");



CREATE INDEX "business_operating_hours_business_id_idx" ON "public"."business_operating_hours" USING "btree" ("business_id");



CREATE INDEX "businesses_user_id_idx" ON "public"."businesses" USING "btree" ("user_id");



CREATE INDEX "client_notifications_booking_id_idx" ON "public"."client_notifications" USING "btree" ("booking_id");



CREATE INDEX "client_notifications_business_id_idx" ON "public"."client_notifications" USING "btree" ("business_id");



CREATE INDEX "client_notifications_client_id_idx" ON "public"."client_notifications" USING "btree" ("client_id");



CREATE INDEX "client_notifications_due_idx" ON "public"."client_notifications" USING "btree" ("next_attempt_at") WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "client_notifications_pending_uniq" ON "public"."client_notifications" USING "btree" ("booking_id", "notification_type", "channel") WHERE ("status" = 'pending'::"text");



CREATE INDEX "client_notifications_scheduled_at_idx" ON "public"."client_notifications" USING "btree" ("scheduled_at");



CREATE INDEX "client_notifications_status_idx" ON "public"."client_notifications" USING "btree" ("status");



CREATE INDEX "clients_business_id_idx" ON "public"."clients" USING "btree" ("business_id");



CREATE UNIQUE INDEX "clients_business_lid_uniq" ON "public"."clients" USING "btree" ("business_id", "lid") WHERE ("lid" IS NOT NULL);



CREATE UNIQUE INDEX "clients_business_phone_uniq" ON "public"."clients" USING "btree" ("business_id", "phone") WHERE ("phone" <> ''::"text");



CREATE INDEX "contact_submissions_created_at_idx" ON "public"."contact_submissions" USING "btree" ("created_at" DESC);



CREATE INDEX "credit_ledger_business_kind_idx" ON "public"."credit_ledger" USING "btree" ("business_id", "kind", "created_at" DESC);



CREATE UNIQUE INDEX "credit_ledger_grant_ref_uniq" ON "public"."credit_ledger" USING "btree" ("ref_id", "source", "kind") WHERE (("ref_id" IS NOT NULL) AND ("source" = ANY (ARRAY['purchase'::"text", 'refund'::"text"])));



CREATE INDEX "credit_ledger_ref_idx" ON "public"."credit_ledger" USING "btree" ("ref_id") WHERE ("ref_id" IS NOT NULL);



CREATE INDEX "email_domains_business_id_idx" ON "public"."email_domains" USING "btree" ("business_id");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_meta_whatsapp_messages_business_id" ON "public"."meta_whatsapp_messages" USING "btree" ("business_id");



CREATE INDEX "inbound_messages_instance_id_idx" ON "public"."inbound_messages" USING "btree" ("instance_id");



CREATE INDEX "inbound_messages_tenant_id_idx" ON "public"."inbound_messages" USING "btree" ("tenant_id", "received_at" DESC);



CREATE INDEX "invoices_business_id_idx" ON "public"."invoices" USING "btree" ("business_id");



CREATE INDEX "invoices_payment_date_idx" ON "public"."invoices" USING "btree" ("payment_date");



CREATE INDEX "invoices_status_idx" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "invoices_subscription_id_idx" ON "public"."invoices" USING "btree" ("subscription_id");



CREATE INDEX "marketing_campaign_recipients_business_id_idx" ON "public"."marketing_campaign_recipients" USING "btree" ("business_id");



CREATE INDEX "marketing_campaign_recipients_campaign_id_idx" ON "public"."marketing_campaign_recipients" USING "btree" ("campaign_id");



CREATE INDEX "marketing_campaign_recipients_scheduled_for_idx" ON "public"."marketing_campaign_recipients" USING "btree" ("scheduled_for");



CREATE INDEX "marketing_campaign_recipients_status_idx" ON "public"."marketing_campaign_recipients" USING "btree" ("status");



CREATE INDEX "marketing_campaigns_business_id_idx" ON "public"."marketing_campaigns" USING "btree" ("business_id");



CREATE INDEX "message_engagement_business_id_idx" ON "public"."message_engagement" USING "btree" ("business_id");



CREATE INDEX "message_engagement_campaign_id_idx" ON "public"."message_engagement" USING "btree" ("campaign_id");



CREATE INDEX "message_engagement_recipient_phone_idx" ON "public"."message_engagement" USING "btree" ("recipient_phone");



CREATE INDEX "message_engagement_responded_at_idx" ON "public"."message_engagement" USING "btree" ("responded_at");



CREATE INDEX "message_engagement_sent_at_idx" ON "public"."message_engagement" USING "btree" ("sent_at");



CREATE UNIQUE INDEX "meta_whatsapp_connections_business_id_idx" ON "public"."meta_whatsapp_connections" USING "btree" ("business_id");



CREATE INDEX "notification_send_state_paused_idx" ON "public"."notification_send_state" USING "btree" ("paused_until") WHERE ("paused_until" IS NOT NULL);



CREATE INDEX "number_warmup_business_id_idx" ON "public"."number_warmup" USING "btree" ("business_id");



CREATE INDEX "number_warmup_status_idx" ON "public"."number_warmup" USING "btree" ("status");



CREATE INDEX "number_warmup_tenant_id_idx" ON "public"."number_warmup" USING "btree" ("tenant_id");



CREATE INDEX "payment_provider_credentials_business_id_idx" ON "public"."payment_provider_credentials" USING "btree" ("business_id");



CREATE INDEX "payment_provider_settings_business_id_idx" ON "public"."payment_provider_settings" USING "btree" ("business_id");



CREATE INDEX "payments_booking_id_idx" ON "public"."payments" USING "btree" ("booking_id");



CREATE INDEX "payments_business_id_idx" ON "public"."payments" USING "btree" ("business_id");



CREATE INDEX "payments_client_id_idx" ON "public"."payments" USING "btree" ("client_id");



CREATE INDEX "payments_paid_at_idx" ON "public"."payments" USING "btree" ("paid_at");



CREATE UNIQUE INDEX "payments_provider_reference_idx" ON "public"."payments" USING "btree" ("provider_reference") WHERE ("provider_reference" IS NOT NULL);



CREATE INDEX "platform_whatsapp_notifications_business_idx" ON "public"."platform_whatsapp_notifications" USING "btree" ("business_id", "kind", "created_at" DESC);



CREATE INDEX "platform_whatsapp_notifications_due_idx" ON "public"."platform_whatsapp_notifications" USING "btree" ("next_attempt_at") WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "platform_whatsapp_notifications_pending_uniq" ON "public"."platform_whatsapp_notifications" USING "btree" ("business_id", "kind") WHERE ("status" = 'pending'::"text");



CREATE INDEX "recipient_insights_business_id_idx" ON "public"."recipient_insights" USING "btree" ("business_id");



CREATE INDEX "recipient_insights_engagement_score_idx" ON "public"."recipient_insights" USING "btree" ("engagement_score" DESC);



CREATE INDEX "recipient_insights_recipient_phone_idx" ON "public"."recipient_insights" USING "btree" ("recipient_phone");



CREATE INDEX "scheduled_campaigns_business_id_idx" ON "public"."scheduled_campaigns" USING "btree" ("business_id");



CREATE INDEX "scheduled_campaigns_scheduled_for_idx" ON "public"."scheduled_campaigns" USING "btree" ("scheduled_for");



CREATE INDEX "scheduled_campaigns_status_idx" ON "public"."scheduled_campaigns" USING "btree" ("status");



CREATE INDEX "services_business_id_idx" ON "public"."services" USING "btree" ("business_id");



CREATE INDEX "staff_daily_summary_log_business_id_idx" ON "public"."staff_daily_summary_log" USING "btree" ("business_id");



CREATE INDEX "staff_members_business_id_idx" ON "public"."staff_members" USING "btree" ("business_id");



CREATE INDEX "staff_notifications_booking_id_idx" ON "public"."staff_notifications" USING "btree" ("booking_id");



CREATE INDEX "staff_notifications_business_id_idx" ON "public"."staff_notifications" USING "btree" ("business_id");



CREATE INDEX "staff_notifications_due_idx" ON "public"."staff_notifications" USING "btree" ("next_attempt_at") WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "staff_notifications_pending_uniq" ON "public"."staff_notifications" USING "btree" ("booking_id", "staff_id", "notification_type", "channel") WHERE ("status" = 'pending'::"text");



CREATE INDEX "staff_notifications_scheduled_at_idx" ON "public"."staff_notifications" USING "btree" ("scheduled_at");



CREATE INDEX "staff_notifications_staff_id_idx" ON "public"."staff_notifications" USING "btree" ("staff_id");



CREATE INDEX "staff_notifications_status_idx" ON "public"."staff_notifications" USING "btree" ("status");



CREATE INDEX "subscription_addon_purchases_business_idx" ON "public"."subscription_addon_purchases" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "subscription_addon_purchases_pending_idx" ON "public"."subscription_addon_purchases" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "subscription_addon_purchases_ref_idx" ON "public"."subscription_addon_purchases" USING "btree" ("payment_ref");



CREATE INDEX "subscription_addons_subscription_id_idx" ON "public"."subscription_addons" USING "btree" ("subscription_id");



CREATE UNIQUE INDEX "subscriptions_business_active_idx" ON "public"."subscriptions" USING "btree" ("business_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "subscriptions_business_id_idx" ON "public"."subscriptions" USING "btree" ("business_id");



CREATE INDEX "subscriptions_current_period_end_idx" ON "public"."subscriptions" USING "btree" ("current_period_end");



CREATE INDEX "subscriptions_payfast_token_idx" ON "public"."subscriptions" USING "btree" ("payfast_token") WHERE ("payfast_token" IS NOT NULL);



CREATE INDEX "subscriptions_plan_id_idx" ON "public"."subscriptions" USING "btree" ("plan_id");



CREATE INDEX "subscriptions_status_idx" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "subscriptions_user_id_idx" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "team_members_business_id_idx" ON "public"."team_members" USING "btree" ("business_id");



CREATE INDEX "team_members_user_id_idx" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "tenants_owner_user_id_idx" ON "public"."tenants" USING "btree" ("owner_user_id");



CREATE UNIQUE INDEX "usage_tracking_business_date_idx" ON "public"."usage_tracking" USING "btree" ("business_id", "tracking_date");



CREATE INDEX "usage_tracking_business_id_idx" ON "public"."usage_tracking" USING "btree" ("business_id");



CREATE INDEX "usage_tracking_date_idx" ON "public"."usage_tracking" USING "btree" ("tracking_date");



CREATE INDEX "usage_tracking_subscription_id_idx" ON "public"."usage_tracking" USING "btree" ("subscription_id");



CREATE INDEX "warmup_config_business_id_idx" ON "public"."warmup_config" USING "btree" ("business_id");



CREATE INDEX "warmup_config_tenant_id_idx" ON "public"."warmup_config" USING "btree" ("tenant_id");



CREATE INDEX "whatsapp_ai_drafts_business_status_idx" ON "public"."whatsapp_ai_drafts" USING "btree" ("business_id", "status", "created_at" DESC);



CREATE INDEX "whatsapp_ai_drafts_inbound_message_idx" ON "public"."whatsapp_ai_drafts" USING "btree" ("inbound_message_id") WHERE ("inbound_message_id" IS NOT NULL);



CREATE INDEX "whatsapp_ai_drafts_remote_jid_idx" ON "public"."whatsapp_ai_drafts" USING "btree" ("business_id", "remote_jid", "created_at" DESC);



CREATE INDEX "whatsapp_bot_faqs_business_id_idx" ON "public"."whatsapp_bot_faqs" USING "btree" ("business_id");



CREATE INDEX "whatsapp_bot_working_hours_business_id_idx" ON "public"."whatsapp_bot_working_hours" USING "btree" ("business_id");



CREATE INDEX "whatsapp_reminders_booking_id_idx" ON "public"."whatsapp_reminders" USING "btree" ("booking_id");



CREATE INDEX "whatsapp_reminders_business_id_idx" ON "public"."whatsapp_reminders" USING "btree" ("business_id");



CREATE INDEX "whatsapp_reminders_scheduled_at_idx" ON "public"."whatsapp_reminders" USING "btree" ("scheduled_at");



CREATE INDEX "whatsapp_session_data_tenant_idx" ON "public"."whatsapp_session_data" USING "btree" ("tenant_id");



CREATE INDEX "whatsapp_sessions_session_data_idx" ON "public"."whatsapp_sessions" USING "gin" ("session_data");



CREATE INDEX "whatsapp_sessions_status_idx" ON "public"."whatsapp_sessions" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "ab_tests_updated_at" BEFORE UPDATE ON "public"."ab_tests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "booking_page_settings_updated_at" BEFORE UPDATE ON "public"."booking_page_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "booking_policies_updated_at" BEFORE UPDATE ON "public"."booking_policies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "bookings_updated_at" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "businesses_seed_booking_policy" AFTER INSERT ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."seed_booking_policy"();



CREATE OR REPLACE TRIGGER "businesses_updated_at" BEFORE UPDATE ON "public"."businesses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "client_notifications_updated_at" BEFORE UPDATE ON "public"."client_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "credit_balances_updated_at" BEFORE UPDATE ON "public"."credit_balances" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "credit_bundles_updated_at" BEFORE UPDATE ON "public"."credit_bundles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "deposit_settings_updated_at" BEFORE UPDATE ON "public"."deposit_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_domains_updated_at" BEFORE UPDATE ON "public"."email_domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoices_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "marketing_campaign_recipients_updated_at" BEFORE UPDATE ON "public"."marketing_campaign_recipients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "marketing_campaigns_updated_at" BEFORE UPDATE ON "public"."marketing_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "message_engagement_updated_at" BEFORE UPDATE ON "public"."message_engagement" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "meta_whatsapp_connections_updated_at" BEFORE UPDATE ON "public"."meta_whatsapp_connections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notification_send_state_updated_at" BEFORE UPDATE ON "public"."notification_send_state" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notification_settings_updated_at" BEFORE UPDATE ON "public"."notification_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "number_warmup_updated_at" BEFORE UPDATE ON "public"."number_warmup" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "owner_approval_alert_state_updated_at" BEFORE UPDATE ON "public"."owner_approval_alert_state" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "payment_provider_credentials_updated_at" BEFORE UPDATE ON "public"."payment_provider_credentials" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "payment_provider_settings_updated_at" BEFORE UPDATE ON "public"."payment_provider_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "payments_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "plan_addons_updated_at" BEFORE UPDATE ON "public"."plan_addons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "platform_whatsapp_notifications_updated_at" BEFORE UPDATE ON "public"."platform_whatsapp_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "recipient_insights_updated_at" BEFORE UPDATE ON "public"."recipient_insights" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "scheduled_campaigns_updated_at" BEFORE UPDATE ON "public"."scheduled_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "staff_members_seat_limit" BEFORE INSERT OR UPDATE ON "public"."staff_members" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_staff_seat_limit"();



CREATE OR REPLACE TRIGGER "staff_members_updated_at" BEFORE UPDATE ON "public"."staff_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "staff_notifications_updated_at" BEFORE UPDATE ON "public"."staff_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "subscription_addons_updated_at" BEFORE UPDATE ON "public"."subscription_addons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "team_members_updated_at" BEFORE UPDATE ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tenants_updated_at" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_manage_booking_client_notifications" AFTER INSERT OR UPDATE OF "start_time", "end_time", "status", "service_id", "client_id", "staff_id" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."manage_booking_client_notifications"();



CREATE OR REPLACE TRIGGER "trigger_manage_booking_staff_notifications" AFTER INSERT OR UPDATE OF "staff_id", "status", "start_time" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."manage_booking_staff_notifications"();



CREATE OR REPLACE TRIGGER "trigger_manage_booking_whatsapp_reminders" AFTER INSERT OR UPDATE OF "start_time", "end_time", "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."manage_booking_whatsapp_reminders"();



CREATE OR REPLACE TRIGGER "update_blacklisted_numbers_updated_at" BEFORE UPDATE ON "public"."blacklisted_numbers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "usage_tracking_updated_at" BEFORE UPDATE ON "public"."usage_tracking" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "warmup_config_updated_at" BEFORE UPDATE ON "public"."warmup_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "whatsapp_ai_drafts_updated_at" BEFORE UPDATE ON "public"."whatsapp_ai_drafts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_bot_faqs_updated_at" BEFORE UPDATE ON "public"."whatsapp_bot_faqs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_bot_settings_updated_at" BEFORE UPDATE ON "public"."whatsapp_bot_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_reminders_updated_at" BEFORE UPDATE ON "public"."whatsapp_reminders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_session_data_updated_at" BEFORE UPDATE ON "public"."whatsapp_session_data" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_sessions_updated_at" BEFORE UPDATE ON "public"."whatsapp_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_settings_updated_at" BEFORE UPDATE ON "public"."whatsapp_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."ab_test_assignments"
    ADD CONSTRAINT "ab_test_assignments_ab_test_id_fkey" FOREIGN KEY ("ab_test_id") REFERENCES "public"."ab_tests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ab_tests"
    ADD CONSTRAINT "ab_tests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ab_tests"
    ADD CONSTRAINT "ab_tests_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blacklisted_numbers"
    ADD CONSTRAINT "blacklisted_numbers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_page_settings"
    ADD CONSTRAINT "booking_page_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_policies"
    ADD CONSTRAINT "booking_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."business_operating_hours"
    ADD CONSTRAINT "business_operating_hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_notifications"
    ADD CONSTRAINT "client_notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_notifications"
    ADD CONSTRAINT "client_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_notifications"
    ADD CONSTRAINT "client_notifications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_balances"
    ADD CONSTRAINT "credit_balances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_ledger"
    ADD CONSTRAINT "credit_ledger_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deposit_settings"
    ADD CONSTRAINT "deposit_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_domains"
    ADD CONSTRAINT "email_domains_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inbound_messages"
    ADD CONSTRAINT "inbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inbound_messages"
    ADD CONSTRAINT "inbound_messages_whatsapp_session_id_fkey" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."marketing_campaign_recipients"
    ADD CONSTRAINT "marketing_campaign_recipients_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketing_campaign_recipients"
    ADD CONSTRAINT "marketing_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_engagement"
    ADD CONSTRAINT "message_engagement_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_engagement"
    ADD CONSTRAINT "message_engagement_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_engagement"
    ADD CONSTRAINT "message_engagement_scheduled_campaign_id_fkey" FOREIGN KEY ("scheduled_campaign_id") REFERENCES "public"."scheduled_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meta_whatsapp_connections"
    ADD CONSTRAINT "meta_whatsapp_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meta_whatsapp_messages"
    ADD CONSTRAINT "meta_whatsapp_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_send_state"
    ADD CONSTRAINT "notification_send_state_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."number_warmup"
    ADD CONSTRAINT "number_warmup_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."owner_approval_alert_state"
    ADD CONSTRAINT "owner_approval_alert_state_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_provider_credentials"
    ADD CONSTRAINT "payment_provider_credentials_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_provider_settings"
    ADD CONSTRAINT "payment_provider_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."platform_whatsapp_notifications"
    ADD CONSTRAINT "platform_whatsapp_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipient_insights"
    ADD CONSTRAINT "recipient_insights_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_campaigns"
    ADD CONSTRAINT "scheduled_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."scheduled_campaigns"
    ADD CONSTRAINT "scheduled_campaigns_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_daily_summary_log"
    ADD CONSTRAINT "staff_daily_summary_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_daily_summary_log"
    ADD CONSTRAINT "staff_daily_summary_log_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_notifications"
    ADD CONSTRAINT "staff_notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_notifications"
    ADD CONSTRAINT "staff_notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_notifications"
    ADD CONSTRAINT "staff_notifications_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_addon_purchases"
    ADD CONSTRAINT "subscription_addon_purchases_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "public"."plan_addons"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscription_addon_purchases"
    ADD CONSTRAINT "subscription_addon_purchases_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_addon_purchases"
    ADD CONSTRAINT "subscription_addon_purchases_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_addons"
    ADD CONSTRAINT "subscription_addons_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "public"."plan_addons"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscription_addons"
    ADD CONSTRAINT "subscription_addons_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pending_plan_id_fkey" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_tracking"
    ADD CONSTRAINT "usage_tracking_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_tracking"
    ADD CONSTRAINT "usage_tracking_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warmup_config"
    ADD CONSTRAINT "warmup_config_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_ai_drafts"
    ADD CONSTRAINT "whatsapp_ai_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_bot_faqs"
    ADD CONSTRAINT "whatsapp_bot_faqs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_bot_settings"
    ADD CONSTRAINT "whatsapp_bot_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_bot_working_hours"
    ADD CONSTRAINT "whatsapp_bot_working_hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_reminders"
    ADD CONSTRAINT "whatsapp_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_reminders"
    ADD CONSTRAINT "whatsapp_reminders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_reminders"
    ADD CONSTRAINT "whatsapp_reminders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_settings"
    ADD CONSTRAINT "whatsapp_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



CREATE POLICY "Businesses can delete their own blacklisted numbers" ON "public"."blacklisted_numbers" FOR DELETE USING (("business_id" IN ( SELECT "businesses"."id"
   FROM "public"."businesses"
  WHERE ("businesses"."user_id" = "auth"."uid"()))));



CREATE POLICY "Businesses can insert their own blacklisted numbers" ON "public"."blacklisted_numbers" FOR INSERT WITH CHECK (("business_id" IN ( SELECT "businesses"."id"
   FROM "public"."businesses"
  WHERE ("businesses"."user_id" = "auth"."uid"()))));



CREATE POLICY "Businesses can update their own blacklisted numbers" ON "public"."blacklisted_numbers" FOR UPDATE USING (("business_id" IN ( SELECT "businesses"."id"
   FROM "public"."businesses"
  WHERE ("businesses"."user_id" = "auth"."uid"()))));



CREATE POLICY "Businesses can view their own blacklisted numbers" ON "public"."blacklisted_numbers" FOR SELECT USING (("business_id" IN ( SELECT "businesses"."id"
   FROM "public"."businesses"
  WHERE ("businesses"."user_id" = "auth"."uid"()))));



CREATE POLICY "Deny anon access" ON "public"."whatsapp_session_data" TO "anon" USING (false);



ALTER TABLE "public"."ab_test_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ab_tests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ab_tests_delete_own" ON "public"."ab_tests" FOR DELETE USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "ab_tests_insert_own" ON "public"."ab_tests" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "ab_tests_select_own" ON "public"."ab_tests" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "ab_tests_update_own" ON "public"."ab_tests" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_events_all_own" ON "public"."activity_events" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."blacklisted_numbers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_page_owner" ON "public"."booking_page_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "booking_page_public_read" ON "public"."booking_page_settings" FOR SELECT TO "authenticated", "anon" USING (("is_published" = true));



ALTER TABLE "public"."booking_page_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_policies_insert_own" ON "public"."booking_policies" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "booking_policies_select_own" ON "public"."booking_policies" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "booking_policies_update_own" ON "public"."booking_policies" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings_all_own" ON "public"."bookings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "bot_faqs_all_own" ON "public"."whatsapp_bot_faqs" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "bot_hours_all_own" ON "public"."whatsapp_bot_working_hours" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "bot_settings_all_own" ON "public"."whatsapp_bot_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."business_operating_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "businesses_delete_own" ON "public"."businesses" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "businesses_insert_own" ON "public"."businesses" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "businesses_select_own" ON "public"."businesses" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "businesses_update_own" ON "public"."businesses" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."client_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_notifications_all_own" ON "public"."client_notifications" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_all_own" ON "public"."clients" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."contact_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_balances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_balances_select_own" ON "public"."credit_balances" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."credit_bundles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_bundles_select_all" ON "public"."credit_bundles" FOR SELECT USING (true);



ALTER TABLE "public"."credit_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_ledger_select_own" ON "public"."credit_ledger" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."deposit_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deposits_all_own" ON "public"."deposit_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "deposits_public_read" ON "public"."deposit_settings" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."booking_page_settings" "bps"
  WHERE (("bps"."business_id" = "deposit_settings"."business_id") AND ("bps"."is_published" = true)))));



ALTER TABLE "public"."email_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_domains_select_own" ON "public"."email_domains" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "hours_all_own" ON "public"."business_operating_hours" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "hours_public_read" ON "public"."business_operating_hours" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."booking_page_settings" "bps"
  WHERE (("bps"."business_id" = "business_operating_hours"."business_id") AND ("bps"."is_published" = true)))));



ALTER TABLE "public"."inbound_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inbound_messages_all_own" ON "public"."inbound_messages" USING ("public"."user_owns_tenant"("tenant_id")) WITH CHECK ("public"."user_owns_tenant"("tenant_id"));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_all_own" ON "public"."invoices" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."marketing_campaign_recipients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_campaign_recipients_own" ON "public"."marketing_campaign_recipients" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."marketing_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_campaigns_delete_own" ON "public"."marketing_campaigns" FOR DELETE USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "marketing_campaigns_insert_own" ON "public"."marketing_campaigns" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "marketing_campaigns_select_own" ON "public"."marketing_campaigns" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "marketing_campaigns_update_own" ON "public"."marketing_campaigns" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."message_engagement" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "message_engagement_insert_own" ON "public"."message_engagement" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "message_engagement_select_own" ON "public"."message_engagement" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "message_engagement_update_own" ON "public"."message_engagement" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."meta_whatsapp_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_whatsapp_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_send_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_send_state_select_own" ON "public"."notification_send_state" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."notification_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_all_own" ON "public"."notification_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."number_warmup" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "number_warmup_select_own" ON "public"."number_warmup" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."owner_approval_alert_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner_approval_alert_state_select_own" ON "public"."owner_approval_alert_state" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."payment_provider_credentials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_provider_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_all_own" ON "public"."payment_provider_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "payments_all_own" ON "public"."payments" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."plan_addons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plan_addons_select_all" ON "public"."plan_addons" FOR SELECT USING (true);



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans_select_all" ON "public"."plans" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."platform_whatsapp_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_whatsapp_notifications_select_own" ON "public"."platform_whatsapp_notifications" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."recipient_insights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recipient_insights_select_own" ON "public"."recipient_insights" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "reminders_all_own" ON "public"."whatsapp_reminders" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."scheduled_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scheduled_campaigns_delete_own" ON "public"."scheduled_campaigns" FOR DELETE USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "scheduled_campaigns_insert_own" ON "public"."scheduled_campaigns" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "scheduled_campaigns_select_own" ON "public"."scheduled_campaigns" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "scheduled_campaigns_update_own" ON "public"."scheduled_campaigns" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_all_own" ON "public"."services" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "services_public_read" ON "public"."services" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."booking_page_settings" "bps"
  WHERE (("bps"."business_id" = "services"."business_id") AND ("bps"."is_published" = true))))));



CREATE POLICY "staff_all_own" ON "public"."staff_members" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."staff_daily_summary_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_daily_summary_log_select_own" ON "public"."staff_daily_summary_log" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."staff_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_notifications_all_own" ON "public"."staff_notifications" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "staff_public_read" ON "public"."staff_members" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."booking_page_settings" "bps"
  WHERE (("bps"."business_id" = "staff_members"."business_id") AND ("bps"."is_published" = true))))));



ALTER TABLE "public"."subscription_addon_purchases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_addon_purchases_select_own" ON "public"."subscription_addon_purchases" FOR SELECT USING ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."subscription_addons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_addons_select_own" ON "public"."subscription_addons" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."subscriptions" "s"
  WHERE (("s"."id" = "subscription_addons"."subscription_id") AND "public"."user_owns_business"("s"."business_id")))));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_delete_own" ON "public"."subscriptions" FOR DELETE USING ((("user_id" = "auth"."uid"()) OR "public"."user_owns_business"("business_id")));



CREATE POLICY "subscriptions_insert_own" ON "public"."subscriptions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."user_owns_business"("business_id")));



CREATE POLICY "subscriptions_select_own" ON "public"."subscriptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."user_owns_business"("business_id")));



CREATE POLICY "subscriptions_update_own" ON "public"."subscriptions" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."user_owns_business"("business_id")));



CREATE POLICY "team_all_own" ON "public"."team_members" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_delete_own" ON "public"."tenants" FOR DELETE USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "tenants_insert_own" ON "public"."tenants" FOR INSERT WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "tenants_select_own" ON "public"."tenants" FOR SELECT USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "tenants_update_own" ON "public"."tenants" FOR UPDATE USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



ALTER TABLE "public"."usage_tracking" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usage_tracking_all_own" ON "public"."usage_tracking" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."warmup_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "warmup_config_insert_own" ON "public"."warmup_config" FOR INSERT WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "warmup_config_select_own" ON "public"."warmup_config" FOR SELECT USING ("public"."user_owns_business"("business_id"));



CREATE POLICY "warmup_config_update_own" ON "public"."warmup_config" FOR UPDATE USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."whatsapp_ai_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_ai_drafts_all_own" ON "public"."whatsapp_ai_drafts" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



CREATE POLICY "whatsapp_all_own" ON "public"."whatsapp_settings" USING ("public"."user_owns_business"("business_id")) WITH CHECK ("public"."user_owns_business"("business_id"));



ALTER TABLE "public"."whatsapp_bot_faqs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_bot_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_bot_working_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_session_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_sessions_all_own" ON "public"."whatsapp_sessions" USING ("public"."user_owns_tenant"("tenant_id")) WITH CHECK ("public"."user_owns_tenant"("tenant_id"));



ALTER TABLE "public"."whatsapp_settings" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."cancel_booking_by_manage_token"("p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_booking_by_manage_token"("p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_booking_by_manage_token"("p_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "postgres";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "anon";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_available_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_available_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_public_booking"("p_slug" "text", "p_service_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_start_time" timestamp with time zone, "p_staff_id" "uuid", "p_notes" "text", "p_client_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_public_booking"("p_slug" "text", "p_service_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_start_time" timestamp with time zone, "p_staff_id" "uuid", "p_notes" "text", "p_client_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_public_booking"("p_slug" "text", "p_service_id" "uuid", "p_client_name" "text", "p_client_phone" "text", "p_start_time" timestamp with time zone, "p_staff_id" "uuid", "p_notes" "text", "p_client_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "postgres";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "anon";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_staff_seat_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_staff_seat_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_staff_seat_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_client_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_client_id" "uuid", "p_type" "text", "p_message" "text", "p_scheduled_at" timestamp with time zone, "p_send_whatsapp" boolean, "p_send_email" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_client_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_client_id" "uuid", "p_type" "text", "p_message" "text", "p_scheduled_at" timestamp with time zone, "p_send_whatsapp" boolean, "p_send_email" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_client_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_client_id" "uuid", "p_type" "text", "p_message" "text", "p_scheduled_at" timestamp with time zone, "p_send_whatsapp" boolean, "p_send_email" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_staff_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_staff_id" "uuid", "p_type" "text", "p_message" "text", "p_send_whatsapp" boolean, "p_send_email" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_staff_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_staff_id" "uuid", "p_type" "text", "p_message" "text", "p_send_whatsapp" boolean, "p_send_email" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_staff_notification"("p_business_id" "uuid", "p_booking_id" "uuid", "p_staff_id" "uuid", "p_type" "text", "p_message" "text", "p_send_whatsapp" boolean, "p_send_email" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_my_business"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_my_business"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_my_business"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_my_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_my_tenant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_my_tenant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "postgres";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "anon";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "service_role";



GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_booking_by_manage_token"("p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_booking_by_manage_token"("p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_booking_by_manage_token"("p_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_business_booking_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_business_booking_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_booking_slots"("p_business_id" "uuid", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_booking_slots"("p_slug" "text", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_slots"("p_slug" "text", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_slots"("p_slug" "text", "p_service_id" "uuid", "p_date" "date", "p_staff_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_source" "text", "p_reason" "text", "p_ref_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_source" "text", "p_reason" "text", "p_ref_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_subscription"("business_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_subscription"("business_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_subscription"("business_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_meta_whatsapp_connection"("p_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_meta_whatsapp_connection"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_meta_whatsapp_connection"("p_business_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "postgres";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "anon";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."manage_booking_client_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."manage_booking_client_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."manage_booking_client_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."manage_booking_staff_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."manage_booking_staff_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."manage_booking_staff_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."manage_booking_whatsapp_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."manage_booking_whatsapp_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."manage_booking_whatsapp_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_phone"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_phone"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_phone"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_booking_slot_is_free"("p_business_id" "uuid", "p_staff_id" "uuid", "p_day_name" "text", "p_slot_start" timestamp with time zone, "p_slot_end" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."reschedule_booking_by_manage_token"("p_token" "uuid", "p_new_start" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."reschedule_booking_by_manage_token"("p_token" "uuid", "p_new_start" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reschedule_booking_by_manage_token"("p_token" "uuid", "p_new_start" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_booking_policy"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_booking_policy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_booking_policy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_bot_defaults"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_bot_defaults"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_business_defaults"("p_business_id" "uuid", "p_owner_name" "text", "p_owner_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_business_defaults"("p_business_id" "uuid", "p_owner_name" "text", "p_owner_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."spend_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_included_limit" integer, "p_period_start" "date", "p_reason" "text", "p_ref_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."spend_credits"("p_business_id" "uuid", "p_kind" "text", "p_amount" integer, "p_included_limit" integer, "p_period_start" "date", "p_reason" "text", "p_ref_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_owns_business"("p_business_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_owns_business"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_owns_business"("p_business_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_owns_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_owns_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_owns_tenant"("p_tenant_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."ab_test_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."ab_test_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."ab_tests" TO "authenticated";
GRANT ALL ON TABLE "public"."ab_tests" TO "service_role";



GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON TABLE "public"."blacklisted_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."blacklisted_numbers" TO "service_role";



GRANT ALL ON TABLE "public"."booking_page_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_page_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."booking_page_settings" TO "anon";



GRANT ALL ON TABLE "public"."booking_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_policies" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."business_operating_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."business_operating_hours" TO "service_role";
GRANT SELECT ON TABLE "public"."business_operating_hours" TO "anon";



GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON TABLE "public"."client_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."client_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."contact_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."credit_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_balances" TO "service_role";



GRANT ALL ON TABLE "public"."credit_bundles" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_bundles" TO "service_role";



GRANT ALL ON TABLE "public"."credit_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."deposit_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."deposit_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."deposit_settings" TO "anon";



GRANT ALL ON TABLE "public"."email_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."email_domains" TO "service_role";



GRANT ALL ON TABLE "public"."inbound_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_messages" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_campaign_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_campaign_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."message_engagement" TO "authenticated";
GRANT ALL ON TABLE "public"."message_engagement" TO "service_role";



GRANT ALL ON TABLE "public"."meta_whatsapp_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_whatsapp_connections" TO "service_role";



GRANT ALL ON TABLE "public"."meta_whatsapp_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_whatsapp_messages" TO "service_role";



GRANT ALL ON TABLE "public"."notification_send_state" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_send_state" TO "service_role";



GRANT ALL ON TABLE "public"."notification_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_settings" TO "service_role";



GRANT ALL ON TABLE "public"."number_warmup" TO "authenticated";
GRANT ALL ON TABLE "public"."number_warmup" TO "service_role";



GRANT ALL ON TABLE "public"."owner_approval_alert_state" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_approval_alert_state" TO "service_role";



GRANT ALL ON TABLE "public"."payment_provider_credentials" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_provider_credentials" TO "service_role";



GRANT ALL ON TABLE "public"."payment_provider_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_provider_settings" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."plan_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_addons" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."platform_whatsapp_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_whatsapp_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."recipient_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."recipient_insights" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";
GRANT SELECT ON TABLE "public"."services" TO "anon";



GRANT ALL ON TABLE "public"."staff_daily_summary_log" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_daily_summary_log" TO "service_role";



GRANT ALL ON TABLE "public"."staff_members" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_members" TO "service_role";
GRANT SELECT ON TABLE "public"."staff_members" TO "anon";



GRANT ALL ON TABLE "public"."staff_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_addon_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_addon_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_addons" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."usage_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_tracking" TO "service_role";



GRANT ALL ON TABLE "public"."warmup_config" TO "authenticated";
GRANT ALL ON TABLE "public"."warmup_config" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_ai_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_ai_drafts" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_bot_faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_bot_faqs" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_bot_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_bot_settings" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_bot_working_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_bot_working_hours" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_session_data" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_session_data" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_settings" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































