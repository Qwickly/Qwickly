-- ============================================================================
-- Migration 050: Staff notification trigger — per-channel (WhatsApp + Email)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Staff notifications were WhatsApp-only. This adds email as a parallel channel
-- (the reliable one for internal staff — WhatsApp-web can't cold-message a staff
-- member who never opened a chat with the business number). Each staff event now
-- reads its WhatsApp column AND its new `_email` column (migration 048):
--   send WhatsApp = staff_<event>
--   send Email    = staff_<event>_email  AND the staff member has an email
-- The daily-summary email fan-out is handled in code (daily-summary.ts).
-- ============================================================================

-- ── 1. Staff enqueue helper (per-channel, with pending-dedup) ────────────────
CREATE OR REPLACE FUNCTION public.enqueue_staff_notification(
  p_business_id   UUID,
  p_booking_id    UUID,
  p_staff_id      UUID,
  p_type          TEXT,
  p_message       TEXT,
  p_send_whatsapp BOOLEAN,
  p_send_email    BOOLEAN
) RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

-- ── 2. Trigger — compute per-channel flags per staff event ───────────────────
CREATE OR REPLACE FUNCTION public.manage_booking_staff_notifications()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
