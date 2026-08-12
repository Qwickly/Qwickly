-- 073_public_booking_validation.sql
--
-- Hardens the public booking path. create_public_booking is the only function an
-- anonymous caller can invoke that writes data, and it trusted its inputs:
-- compute_available_slots did all the validation, but that only produces the
-- slot list the browser renders. The RPC itself is directly callable, so none of
-- those checks were enforced on the write.
--
-- Four fixes, plus opening-hours enforcement on the reschedule path.
-- Idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Phone normalisation.
--
-- create_public_booking matches an existing client on phone with a raw string
-- comparison, and the booking page posts whatever the customer typed. So the
-- same person booking as "0821234567" and later "+27 82 123 4567" produced two
-- client records — clients_business_phone_uniq does not catch it, because those
-- are different strings.
--
-- Mirrors normalizeClientPhone in artifacts/bookza/src/lib/catalog.ts, which
-- already existed but was never used on this path. Putting it in the database
-- means every caller gets it — booking page, WhatsApp bot, and anything added
-- later — rather than one client remembering to call it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN d = ''                THEN ''
           WHEN d ~ '^0[0-9]{9}$'     THEN '27' || substring(d from 2)
           WHEN length(d) = 9         THEN '27' || d
           ELSE d
         END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) t;
$$;

-- Backfill existing rows so historical clients still match new lookups.
-- Checked before writing: of 1263 clients, 1250 are already in 27XXXXXXXXX form
-- and 4 are 0XXXXXXXXX; normalising produces zero collisions against
-- clients_business_phone_uniq. The WHERE clause makes this a no-op on re-run.
UPDATE public.clients
SET phone = public.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND phone <> ''
  AND phone <> public.normalize_phone(phone);

-- ---------------------------------------------------------------------------
-- 1. Overlap protection for bookings with no assigned staff.
--
-- bookings_staff_no_overlap only applies WHERE staff_id IS NOT NULL, so
-- unassigned bookings could be stacked on one slot without limit. Businesses
-- with no staff records legitimately create these, hence a business-level guard
-- rather than making staff_id mandatory.
--
-- Verified before writing: zero overlapping NULL-staff pairs exist, so this
-- applies cleanly to current data. btree_gist is already installed (the existing
-- exclusion constraint needs it for the `= ` operator).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_staff_no_overlap'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_no_staff_no_overlap
      EXCLUDE USING gist (
        business_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      )
      WHERE (staff_id IS NULL AND status = ANY (ARRAY['pending'::text, 'confirmed'::text]));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. create_public_booking: validate the requested time, and stop overwriting
--    existing client records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_slug text,
  p_service_id uuid,
  p_client_name text,
  p_client_phone text,
  p_start_time timestamp with time zone,
  p_staff_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_client_email text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. reschedule_booking_by_manage_token: enforce opening hours.
--
-- This function was already sound on the things that matter most — it checks
-- booking status, accept_reschedules, the minimum-notice window, that the new
-- time is in the future, and that nothing overlaps (handling both the assigned
-- staff and no-staff cases, excluding the booking itself). The overlap check is
-- inline rather than via public_booking_slot_is_free because the helper has no
-- way to exclude the booking being moved.
--
-- The one gap: no opening-hours validation, so a customer holding a manage token
-- could move their booking to 03:00, or to a day the business is closed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_booking_by_manage_token(
  p_token uuid,
  p_new_start timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
