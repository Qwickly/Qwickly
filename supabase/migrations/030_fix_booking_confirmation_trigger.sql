-- ============================================================================
-- Migration 030: Fix booking_confirmations trigger — only fire when confirmed
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Bug: the manage_booking_client_notifications trigger fired the
-- booking_confirmations notification on every INSERT regardless of status.
-- When the WhatsApp bot creates a booking as "pending" (auto-confirm OFF):
--   1. The trigger immediately enqueues "has been confirmed" (factually wrong)
--   2. The bot sends a conversational reply (now fixed to say "request submitted")
--   3. Staff approves → trigger fires again → sends "has been confirmed" (correct)
--
-- Result: customer got a false "confirmed" message before staff ever approved,
-- plus a legitimate one after approval.
--
-- Fix: the booking_confirmations queue message should only fire when the booking
-- actually reaches "confirmed" status:
--   • INSERT with status = 'confirmed'  → auto-confirm ON, fire immediately
--   • UPDATE old != 'confirmed', new = 'confirmed' → staff approval, fire then
--   • INSERT with status = 'pending'   → do NOT fire (bot's reply handles this)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.manage_booking_client_notifications()
RETURNS TRIGGER AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_settings RECORD;
  v_booking_date TEXT;
  v_booking_time TEXT;
  v_msg TEXT;
BEGIN
  -- Always delete existing pending notifications for this booking first.
  -- Prevents duplicate/outdated notifications if a booking is updated.
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

  SELECT business_name INTO v_business_name
  FROM public.businesses
  WHERE id = NEW.business_id;

  SELECT name, phone INTO v_client_name, v_client_phone
  FROM public.clients
  WHERE id = NEW.client_id;

  SELECT name INTO v_service_name
  FROM public.services
  WHERE id = NEW.service_id;

  IF NEW.staff_id IS NOT NULL THEN
    SELECT name INTO v_staff_name
    FROM public.staff_members
    WHERE id = NEW.staff_id;
  ELSE
    v_staff_name := 'Staff';
  END IF;

  v_booking_date := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_booking_time := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- ── 1. Cancellation notice ────────────────────────────────────────────────
  IF NEW.status = 'cancelled' THEN
    IF v_settings.cancellation_notices AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'cancelled')) THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been cancelled.';
      INSERT INTO public.client_notifications
        (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
      VALUES
        (NEW.business_id, NEW.id, NEW.client_id, 'cancellation_notices', v_msg, now(), 'pending');
    END IF;
    RETURN NEW;
  END IF;

  -- ── 2. Rescheduling alert ─────────────────────────────────────────────────
  IF TG_OP = 'UPDATE' AND OLD.start_time != NEW.start_time AND v_settings.rescheduling_alerts THEN
    v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' has been rescheduled to ' || v_booking_date || ' at ' || v_booking_time || '.';
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.client_id, 'rescheduling_alerts', v_msg, now(), 'pending');
  END IF;

  -- ── 3. Booking notifications — queue owns all status messages ────────────
  -- The WhatsApp bot only sends a brief conversational acknowledgment; all
  -- formal booking messages with details go through the queue here.
  --
  --   • INSERT with status = 'pending'   → "received, awaiting confirmation"
  --   • INSERT with status = 'confirmed' → "confirmed" (auto-confirm ON)
  --   • UPDATE non-confirmed → 'confirmed' → "confirmed" (staff approval)
  IF v_settings.booking_confirmations THEN
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
      INSERT INTO public.client_notifications
        (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
      VALUES
        (NEW.business_id, NEW.id, NEW.client_id, 'booking_confirmations', v_msg, now(), 'pending');
    END IF;
  END IF;

  -- ── 4. 24h reminder ──────────────────────────────────────────────────────
  IF v_settings.reminder_24h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', this is a reminder for your upcoming appointment for ' || v_service_name || ' with ' || v_staff_name || ' on ' || v_booking_date || ' at ' || v_booking_time || '. See you soon!';
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.client_id, 'reminder_24h', v_msg, NEW.start_time - INTERVAL '24 hours', 'pending');
  END IF;

  -- ── 5. 2h reminder ───────────────────────────────────────────────────────
  IF v_settings.reminder_2h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', your appointment for ' || v_service_name || ' with ' || v_staff_name || ' starts in 2 hours (at ' || v_booking_time || '). See you soon!';
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.client_id, 'reminder_2h', v_msg, NEW.start_time - INTERVAL '2 hours', 'pending');
  END IF;

  -- ── 6. Review request ─────────────────────────────────────────────────────
  IF v_settings.review_requests AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := 'Hi ' || v_client_name || ', thanks for visiting ' || v_business_name || ' today! How was your appointment for ' || v_service_name || '? We would love to hear your feedback!';
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.client_id, 'review_requests', v_msg, NEW.end_time + INTERVAL '2 hours', 'pending');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
