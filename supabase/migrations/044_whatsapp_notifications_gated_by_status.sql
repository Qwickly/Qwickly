-- ============================================================================
-- Migration 044: Only queue WhatsApp notifications for reachable clients
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Problem: the booking notification trigger fans out a WhatsApp row for EVERY
-- client. But a client with no WhatsApp conversation (status = 'new' — e.g. a
-- public/calendar booking) can't be reached over the whatsapp-web.js session, so
-- that row is a guaranteed failure: wasted retries, dead 'failed' rows, and it
-- feeds the per-business auto-pause.
--
-- The client `status` field already encodes WhatsApp reachability:
--   'active' = has a live WhatsApp conversation (set by the inbound handler) → reachable
--   'new'    = no conversation yet (manual add / public booking)            → not reachable
--
-- So we gate the WhatsApp row on status = 'active'. Email is unaffected: a 'new'
-- client with an email still gets the email notification (their correct channel).
-- Only change vs migration 041: enqueue_client_notification gains a
-- p_whatsapp_eligible flag, and the trigger passes (status = 'active').
-- ============================================================================

-- ── 1. Enqueue helper — WhatsApp row now conditional ─────────────────────────
-- Adding a parameter changes the signature, so drop the old 8-arg version first
-- (otherwise it lingers as a second overload).
DROP FUNCTION IF EXISTS public.enqueue_client_notification(
  UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION public.enqueue_client_notification(
  p_business_id      UUID,
  p_booking_id       UUID,
  p_client_id        UUID,
  p_type             TEXT,
  p_message          TEXT,
  p_scheduled_at     TIMESTAMPTZ,
  p_email_enabled    BOOLEAN,
  p_client_email     TEXT,
  p_whatsapp_eligible BOOLEAN DEFAULT true
) RETURNS void AS $$
BEGIN
  -- WhatsApp only when the client is actually reachable there (has a conversation).
  -- Skipping it for 'new' clients avoids queuing a guaranteed-to-fail send.
  IF p_whatsapp_eligible THEN
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'whatsapp');
  END IF;

  IF p_email_enabled AND p_client_email IS NOT NULL AND p_client_email <> '' THEN
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'email');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Rebuild the booking notification trigger (migration 041 body) ─────────
-- Only change: load the client's `status`, derive v_whatsapp_eligible, and pass
-- it to every enqueue_client_notification() call.
CREATE OR REPLACE FUNCTION public.manage_booking_client_notifications()
RETURNS TRIGGER AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_client_email TEXT;
  v_client_status TEXT;
  v_whatsapp_eligible BOOLEAN;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_settings RECORD;
  v_email_enabled BOOLEAN;
  v_booking_date TEXT;
  v_booking_time TEXT;
  v_msg TEXT;
BEGIN
  -- Always delete existing pending notifications for this booking first (both
  -- channels). Prevents duplicate/outdated notifications if a booking is updated.
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

  v_email_enabled := COALESCE(v_settings.email_enabled, false);

  SELECT business_name INTO v_business_name
  FROM public.businesses
  WHERE id = NEW.business_id;

  -- Client status drives WhatsApp eligibility: only 'active' (a live WhatsApp
  -- conversation) can be reached over the web session. NOTE: this is the CLIENT
  -- status, distinct from NEW.status (the booking status) used below.
  SELECT name, phone, email, status
    INTO v_client_name, v_client_phone, v_client_email, v_client_status
  FROM public.clients
  WHERE id = NEW.client_id;

  v_whatsapp_eligible := (COALESCE(v_client_status, 'new') = 'active');

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

  -- 1. Cancellation notice
  IF NEW.status = 'cancelled' THEN
    IF v_settings.cancellation_notices AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'cancelled')) THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been cancelled.';
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'cancellation_notices', v_msg, now(), v_email_enabled, v_client_email, v_whatsapp_eligible);
    END IF;
    RETURN NEW;
  END IF;

  -- 2. Rescheduling alert
  IF TG_OP = 'UPDATE' AND OLD.start_time != NEW.start_time AND v_settings.rescheduling_alerts THEN
    v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' has been rescheduled to ' || v_booking_date || ' at ' || v_booking_time || '.';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'rescheduling_alerts', v_msg, now(), v_email_enabled, v_client_email, v_whatsapp_eligible);
  END IF;

  -- Reset before status notifications so a reschedule message cannot be reused
  -- as a booking confirmation.
  v_msg := NULL;

  -- 3. Booking notifications - queue owns all status messages
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
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'booking_confirmations', v_msg, now(), v_email_enabled, v_client_email, v_whatsapp_eligible);
    END IF;
  END IF;

  -- Reset before reminder/review sections.
  v_msg := NULL;

  -- 4. 24-hour reminder
  IF v_settings.reminder_24h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', this is a reminder for your upcoming appointment for ' || v_service_name || ' with ' || v_staff_name || ' on ' || v_booking_date || ' at ' || v_booking_time || '. See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_24h', v_msg, NEW.start_time - INTERVAL '24 hours', v_email_enabled, v_client_email, v_whatsapp_eligible);
  END IF;

  -- 5. 2-hour reminder
  IF v_settings.reminder_2h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', your appointment for ' || v_service_name || ' with ' || v_staff_name || ' starts in 2 hours (at ' || v_booking_time || '). See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_2h', v_msg, NEW.start_time - INTERVAL '2 hours', v_email_enabled, v_client_email, v_whatsapp_eligible);
  END IF;

  -- 6. Review request
  IF v_settings.review_requests AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := 'Hi ' || v_client_name || ', thanks for visiting ' || v_business_name || ' today! How was your appointment for ' || v_service_name || '? We would love to hear your feedback!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'review_requests', v_msg, NEW.end_time + INTERVAL '2 hours', v_email_enabled, v_client_email, v_whatsapp_eligible);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
