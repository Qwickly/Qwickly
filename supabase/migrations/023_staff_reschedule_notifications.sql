-- ============================================================================
-- Migration 023: Staff Reschedule Notifications
-- Adds a "reschedule" notification to the staff queue (migration 014), fired
-- when a booking's start_time changes. Mirrors the client-side
-- rescheduling_alerts handled in migration 015.
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- ── 1. Settings flag (opt-in, matches staff_new_booking / staff_cancellation) ─

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS staff_reschedule BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Allow the new notification_type on the staff queue ────────────────────
-- The CHECK was created inline in migration 014, so replace it here.

ALTER TABLE public.staff_notifications
  DROP CONSTRAINT IF EXISTS staff_notifications_notification_type_check;

ALTER TABLE public.staff_notifications
  ADD CONSTRAINT staff_notifications_notification_type_check
  CHECK (notification_type IN ('new_booking', 'cancellation', 'reschedule'));

-- ── 3. Replace the staff notification trigger function ───────────────────────
-- Identical to migration 014 plus a reschedule block, and the function is
-- re-applied so the new block takes effect.

CREATE OR REPLACE FUNCTION public.manage_booking_staff_notifications()
RETURNS TRIGGER AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_booking_date TEXT;
  v_booking_time TEXT;
  v_settings RECORD;
  v_msg TEXT;
BEGIN
  -- Load settings for this business to check if staff notifications are enabled
  SELECT * INTO v_settings
  FROM public.notification_settings
  WHERE business_id = NEW.business_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Helper data lookup
  SELECT business_name INTO v_business_name
  FROM public.businesses
  WHERE id = NEW.business_id;

  SELECT name INTO v_client_name
  FROM public.clients
  WHERE id = NEW.client_id;

  SELECT name INTO v_service_name
  FROM public.services
  WHERE id = NEW.service_id;

  -- Format date and time (South Africa SAST timezone: UTC+2)
  v_booking_date := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_booking_time := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- ── Handle staff_new_booking notification ──────────────────────────────
  -- Triggered on INSERT or when staff_id changes or when status becomes confirmed
  IF v_settings.staff_new_booking AND NEW.staff_id IS NOT NULL THEN
    -- Only notify on new assignment or on first confirmation
    -- Do NOT notify on mere updates (avoid re-triggering)
    IF TG_OP = 'INSERT' OR
       (TG_OP = 'UPDATE' AND (OLD.staff_id IS NULL OR OLD.staff_id != NEW.staff_id)) THEN

      SELECT name INTO v_staff_name
      FROM public.staff_members
      WHERE id = NEW.staff_id;

      v_msg := 'New booking assigned to you:' || E'\n' ||
               'Client: ' || v_client_name || E'\n' ||
               'Service: ' || v_service_name || E'\n' ||
               'Date: ' || v_booking_date || E'\n' ||
               'Time: ' || v_booking_time;

      -- Delete any duplicate pending notifications for this assignment
      DELETE FROM public.staff_notifications
      WHERE booking_id = NEW.id
        AND staff_id = NEW.staff_id
        AND notification_type = 'new_booking'
        AND status = 'pending';

      INSERT INTO public.staff_notifications
        (business_id, booking_id, staff_id, notification_type, message, status)
      VALUES
        (NEW.business_id, NEW.id, NEW.staff_id, 'new_booking', v_msg, 'pending');
    END IF;
  END IF;

  -- ── Handle staff_reschedule notification ─────────────────────────────────
  -- Triggered on UPDATE when start_time changes on a still-active booking.
  IF v_settings.staff_reschedule AND TG_OP = 'UPDATE' AND
     OLD.start_time != NEW.start_time AND NEW.status != 'cancelled' AND
     NEW.staff_id IS NOT NULL THEN

    SELECT name INTO v_staff_name
    FROM public.staff_members
    WHERE id = NEW.staff_id;

    v_msg := 'Booking rescheduled:' || E'\n' ||
             'Client: ' || v_client_name || E'\n' ||
             'Service: ' || v_service_name || E'\n' ||
             'New date: ' || v_booking_date || E'\n' ||
             'New time: ' || v_booking_time;

    -- Delete any duplicate pending notifications for this reschedule
    DELETE FROM public.staff_notifications
    WHERE booking_id = NEW.id
      AND staff_id = NEW.staff_id
      AND notification_type = 'reschedule'
      AND status = 'pending';

    INSERT INTO public.staff_notifications
      (business_id, booking_id, staff_id, notification_type, message, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.staff_id, 'reschedule', v_msg, 'pending');
  END IF;

  -- ── Handle staff_cancellation notification ───────────────────────────────
  -- Triggered only on UPDATE when status changes to cancelled
  IF v_settings.staff_cancellation AND TG_OP = 'UPDATE' AND
     OLD.status != 'cancelled' AND NEW.status = 'cancelled' AND
     NEW.staff_id IS NOT NULL THEN

    SELECT name INTO v_staff_name
    FROM public.staff_members
    WHERE id = NEW.staff_id;

    v_msg := 'Booking cancelled:' || E'\n' ||
             'Client: ' || v_client_name || E'\n' ||
             'Service: ' || v_service_name || E'\n' ||
             'Date: ' || v_booking_date || E'\n' ||
             'Time: ' || v_booking_time;

    -- Delete any duplicate pending notifications for this cancellation
    DELETE FROM public.staff_notifications
    WHERE booking_id = NEW.id
      AND staff_id = NEW.staff_id
      AND notification_type = 'cancellation'
      AND status = 'pending';

    INSERT INTO public.staff_notifications
      (business_id, booking_id, staff_id, notification_type, message, status)
    VALUES
      (NEW.business_id, NEW.id, NEW.staff_id, 'cancellation', v_msg, 'pending');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. Recreate the trigger so it also fires on start_time changes ───────────

DROP TRIGGER IF EXISTS trigger_manage_booking_staff_notifications ON public.bookings;
CREATE TRIGGER trigger_manage_booking_staff_notifications
  AFTER INSERT OR UPDATE OF staff_id, status, start_time ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_booking_staff_notifications();
