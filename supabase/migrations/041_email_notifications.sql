-- ============================================================================
-- Migration 041: Email notification channel
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Adds email as a SECOND delivery channel for the existing client notification
-- events (booking confirmations, 24h/2h reminders, cancellations, etc.) without
-- changing WhatsApp behaviour.
--
-- Design:
--   • client_notifications gains a `channel` column ('whatsapp' | 'email').
--     Every existing row defaults to 'whatsapp' — zero behaviour change.
--   • notification_settings gains `email_enabled` (per-business master switch).
--     The existing per-event toggles still decide WHICH events fire; email_enabled
--     decides whether each fired event ALSO goes out by email. "Which event" and
--     "which channel" stay orthogonal.
--   • The trigger enqueues a WhatsApp row (as before) and, when email_enabled is on
--     AND the client has an email address, a parallel email row with the same
--     message/scheduled_at. Each channel has its own status/retry, so one failing
--     never blocks the other (see notification-worker.ts).
-- ============================================================================

-- ── 1. Schema changes ───────────────────────────────────────────────────────

ALTER TABLE public.client_notifications
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'email'));

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false;

-- The pending-dedup unique index from migration 024 was (booking_id,
-- notification_type) — one pending row per event. Now that each event can fan
-- out to two channels, the same booking/type legitimately needs one pending row
-- PER channel, so channel must be part of the uniqueness key. Without this, the
-- email insert collides with the WhatsApp insert (client_notifications_pending_uniq
-- violation) and the whole booking write fails. Dedup within a channel — the
-- original intent, guarding against double-inserts — is preserved.
DROP INDEX IF EXISTS public.client_notifications_pending_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS client_notifications_pending_uniq
  ON public.client_notifications (booking_id, notification_type, channel)
  WHERE status = 'pending';

-- ── 2. Enqueue helper ───────────────────────────────────────────────────────
-- Inserts the WhatsApp row (always, preserving existing behaviour) and, when the
-- business has email enabled and the client has an email, a parallel email row.
-- Centralising this keeps the trigger below from repeating a double-insert six times.

CREATE OR REPLACE FUNCTION public.enqueue_client_notification(
  p_business_id   UUID,
  p_booking_id    UUID,
  p_client_id     UUID,
  p_type          TEXT,
  p_message       TEXT,
  p_scheduled_at  TIMESTAMPTZ,
  p_email_enabled BOOLEAN,
  p_client_email  TEXT
) RETURNS void AS $$
BEGIN
  INSERT INTO public.client_notifications
    (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
  VALUES
    (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'whatsapp');

  IF p_email_enabled AND p_client_email IS NOT NULL AND p_client_email <> '' THEN
    INSERT INTO public.client_notifications
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status, channel)
    VALUES
      (p_business_id, p_booking_id, p_client_id, p_type, p_message, p_scheduled_at, 'pending', 'email');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Rebuild the booking notification trigger to use the helper ────────────
-- Based on migration 033 (the current version). Only change: every direct
-- INSERT into client_notifications is now an enqueue_client_notification() call
-- that also fans out to email, and we load the client's email alongside name/phone.

CREATE OR REPLACE FUNCTION public.manage_booking_client_notifications()
RETURNS TRIGGER AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_client_email TEXT;
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

  SELECT name, phone, email INTO v_client_name, v_client_phone, v_client_email
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

  -- 1. Cancellation notice
  IF NEW.status = 'cancelled' THEN
    IF v_settings.cancellation_notices AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'cancelled')) THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been cancelled.';
      PERFORM public.enqueue_client_notification(
        NEW.business_id, NEW.id, NEW.client_id, 'cancellation_notices', v_msg, now(), v_email_enabled, v_client_email);
    END IF;
    RETURN NEW;
  END IF;

  -- 2. Rescheduling alert
  IF TG_OP = 'UPDATE' AND OLD.start_time != NEW.start_time AND v_settings.rescheduling_alerts THEN
    v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' has been rescheduled to ' || v_booking_date || ' at ' || v_booking_time || '.';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'rescheduling_alerts', v_msg, now(), v_email_enabled, v_client_email);
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
        NEW.business_id, NEW.id, NEW.client_id, 'booking_confirmations', v_msg, now(), v_email_enabled, v_client_email);
    END IF;
  END IF;

  -- Reset before reminder/review sections.
  v_msg := NULL;

  -- 4. 24-hour reminder
  IF v_settings.reminder_24h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', this is a reminder for your upcoming appointment for ' || v_service_name || ' with ' || v_staff_name || ' on ' || v_booking_date || ' at ' || v_booking_time || '. See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_24h', v_msg, NEW.start_time - INTERVAL '24 hours', v_email_enabled, v_client_email);
  END IF;

  -- 5. 2-hour reminder
  IF v_settings.reminder_2h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', your appointment for ' || v_service_name || ' with ' || v_staff_name || ' starts in 2 hours (at ' || v_booking_time || '). See you soon!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'reminder_2h', v_msg, NEW.start_time - INTERVAL '2 hours', v_email_enabled, v_client_email);
  END IF;

  -- 6. Review request
  IF v_settings.review_requests AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := 'Hi ' || v_client_name || ', thanks for visiting ' || v_business_name || ' today! How was your appointment for ' || v_service_name || '? We would love to hear your feedback!';
    PERFORM public.enqueue_client_notification(
      NEW.business_id, NEW.id, NEW.client_id, 'review_requests', v_msg, NEW.end_time + INTERVAL '2 hours', v_email_enabled, v_client_email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
