-- ─────────────────────────────────────────────────────────────────────────────
-- Post-trial grace week for the public booking page
--
-- When a card-free trial ends the owner is locked out of the dashboard, but
-- their booking page is a link they have already given to customers. Killing it
-- the same minute punishes the customers rather than the business, so the page
-- keeps working for a week.
--
-- The grace week is not just politeness — it is the conversion argument. Every
-- booking taken during it is a real appointment the owner cannot see, and the
-- worker in api-server/src/workers/grace-bookings.ts mails them a running count.
-- "Four people booked while you were away" is a far better reason to come back
-- than any countdown email.
--
-- Access is decided at READ time from the subscription, never by flipping
-- is_published. Publishing state belongs to the owner: if we unpublished their
-- page on expiry, paying us again would silently leave it offline until they
-- noticed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Access state for a business's public booking page ───────────────────────
-- 'open'   — live subscription (or a trial that is still running).
-- 'grace'  — trial expired or subscription cancelled within the last week.
-- 'closed' — past that, or never had a subscription at all.
CREATE OR REPLACE FUNCTION "public"."business_booking_access"("p_business_id" "uuid")
RETURNS "text"
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        -- A live subscription. 'trialing' still counts as live only while the
        -- trial has time left: the hourly sweep restatuses expired trials, but
        -- access must never depend on a worker having run.
        WHEN s.status = 'active' THEN 'open'
        WHEN s.status = 'trialing' AND s.current_period_end > now() THEN 'open'

        -- Grace belongs to subscriptions that WERE live and lapsed, and to those
        -- only. The status list is explicit rather than a catch-all: an
        -- 'incomplete' row is a checkout somebody started and abandoned, and
        -- checkout writes current_period_end a month into the future before any
        -- money changes hands. A catch-all "ended within 7 days" test reads that
        -- future date as a recent lapse and hands a month of free booking page to
        -- someone who never paid.
        WHEN s.status IN ('trial_expired', 'canceled', 'past_due')
             AND s.current_period_end > now() - INTERVAL '7 days' THEN 'grace'

        ELSE 'closed'
      END
      FROM public.subscriptions s
      WHERE s.business_id = p_business_id
      ORDER BY
        -- Same precedence as the entitlement resolver: prefer a live row, then
        -- a recoverable one, then whatever is most recent.
        CASE s.status
          WHEN 'active' THEN 0
          WHEN 'trialing' THEN 1
          WHEN 'past_due' THEN 2
          ELSE 3
        END,
        s.created_at DESC
      LIMIT 1
    ),
    'closed'
  );
$$;

ALTER FUNCTION "public"."business_booking_access"("p_business_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") IS
  'open | grace | closed — whether a business''s public booking page still accepts bookings. Grace is the 7 days after a trial expires or a subscription is cancelled.';

-- Deliberately NOT granted to anon or authenticated. business_id is public
-- (booking_page_settings is anon-readable and carries it), so a direct EXECUTE
-- grant would let anybody ask whether a named business's subscription has
-- lapsed — a billing fact about our customer, exposed to their customers.
--
-- Nothing needs it: get_public_booking_page_state, get_public_booking_slots and
-- create_public_booking are all SECURITY DEFINER and execute as postgres.
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") TO "service_role";


-- ── What the public page should render ──────────────────────────────────────
-- The page itself is read straight from booking_page_settings with the anon
-- key, so without this it has no way to tell "closed" from "does not exist" and
-- would show a customer a 404 for a business that is simply between plans.
-- Returns only a boolean: whose subscription lapsed and when is nobody's
-- business but the owner's.
CREATE OR REPLACE FUNCTION "public"."get_public_booking_page_state"("p_slug" "text")
RETURNS TABLE("accepting" boolean)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
  v_business_id UUID;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.booking_page_settings
  WHERE slug = p_slug AND is_published = true
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT public.business_booking_access(v_business_id) <> 'closed';
END;
$$;

ALTER FUNCTION "public"."get_public_booking_page_state"("p_slug" "text") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."get_public_booking_page_state"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_booking_page_state"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_booking_page_state"("p_slug" "text") TO "service_role";


-- ── Slots stop being offered once the page is closed ────────────────────────
-- Replaced in full (it is six lines); the only change is the access check.
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

  -- No slots at all once the grace week is over. The page explains itself via
  -- get_public_booking_page_state; this is the enforcement.
  IF public.business_booking_access(v_business_id) = 'closed' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM public.compute_available_slots(v_business_id, p_service_id, p_date, p_staff_id);
END;
$$;


-- ── Booking creation is gated too ───────────────────────────────────────────
-- Hiding the slots is not enough on its own: create_public_booking is granted
-- to anon and takes a start_time straight from the caller, so anything that
-- only hid the UI would still accept a hand-made request.
--
-- This is the existing function, unchanged except for the access guard.

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

  -- Post-trial grace. A business whose trial ended keeps taking bookings for a
  -- week (see business_booking_access) so its customers are not turned away the
  -- morning after, and so there is something concrete waiting when the owner
  -- comes back. Past that window the page stops accepting.
  IF public.business_booking_access(v_business_id) = 'closed' THEN
    RAISE EXCEPTION 'This business is not accepting online bookings at the moment';
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


-- ── Owner alerts during the grace week ──────────────────────────────────────
-- One row per business per day that we told them about bookings taken while
-- they were locked out. Claimed before sending, same as trial_reminder_log:
-- overlapping worker ticks must not mail the same person twice.
CREATE TABLE IF NOT EXISTS "public"."grace_booking_alerts" (
  "business_id" "uuid" NOT NULL REFERENCES "public"."businesses"("id") ON DELETE CASCADE,
  "sent_on" "date" NOT NULL,
  "booking_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  PRIMARY KEY ("business_id", "sent_on")
);

COMMENT ON TABLE "public"."grace_booking_alerts" IS
  'One row per business per day a "N bookings while you were away" email went out during the post-trial grace week. Primary key doubles as the send claim.';

-- Service-role only: RLS on, no policies.
ALTER TABLE "public"."grace_booking_alerts" ENABLE ROW LEVEL SECURITY;
