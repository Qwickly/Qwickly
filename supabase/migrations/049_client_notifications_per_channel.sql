-- ============================================================================
-- Migration 049: Client notification trigger — per-channel gating
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Reworks enqueue_client_notification + manage_booking_client_notifications
-- (last defined in migrations 041/044) so each event decides WhatsApp and Email
-- independently, from the per-event columns added in migration 048:
--   send WhatsApp  = <event> (the existing column)   AND client is WhatsApp-reachable
--   send Email     = <event>_email (the new column)  AND client has an email
-- Replaces the old model (single event column + email_enabled master switch).
-- ============================================================================

-- ── 1. Enqueue helper — explicit per-channel booleans ────────────────────────
DROP FUNCTION IF EXISTS public.enqueue_client_notification(
  UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.enqueue_client_notification(
  p_business_id  UUID,
  p_booking_id   UUID,
  p_client_id    UUID,
  p_type         TEXT,
  p_message      TEXT,
  p_scheduled_at TIMESTAMPTZ,
  p_send_whatsapp BOOLEAN,
  p_send_email    BOOLEAN
) RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

-- ── 2. Trigger — compute per-channel flags per event ─────────────────────────
CREATE OR REPLACE FUNCTION public.manage_booking_client_notifications()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
