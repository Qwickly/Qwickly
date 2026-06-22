-- ============================================================================
-- Migration 014: Staff Notifications (New Booking Assigned, Cancellation)
-- Provides a queue-based system for staff WhatsApp notifications
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- ── 1. Create staff_notifications table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  staff_id      UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('new_booking', 'cancellation')),
  message       TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for fast lookups by business and status
CREATE INDEX IF NOT EXISTS staff_notifications_business_id_idx 
  ON public.staff_notifications(business_id);
CREATE INDEX IF NOT EXISTS staff_notifications_staff_id_idx 
  ON public.staff_notifications(staff_id);
CREATE INDEX IF NOT EXISTS staff_notifications_status_idx 
  ON public.staff_notifications(status);
CREATE INDEX IF NOT EXISTS staff_notifications_booking_id_idx 
  ON public.staff_notifications(booking_id);
CREATE INDEX IF NOT EXISTS staff_notifications_scheduled_at_idx 
  ON public.staff_notifications(scheduled_at);

-- Enable RLS and setup policy
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_notifications_all_own" ON public.staff_notifications;
CREATE POLICY "staff_notifications_all_own" ON public.staff_notifications
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Trigger for updating updated_at timestamp
DROP TRIGGER IF EXISTS staff_notifications_updated_at ON public.staff_notifications;
CREATE TRIGGER staff_notifications_updated_at
  BEFORE UPDATE ON public.staff_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. PL/pgSQL Function: manage_booking_staff_notifications ──────────────

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

-- ── 3. Attach Trigger to Bookings Table ──────────────────────────────────

DROP TRIGGER IF EXISTS trigger_manage_booking_staff_notifications ON public.bookings;
CREATE TRIGGER trigger_manage_booking_staff_notifications
  AFTER INSERT OR UPDATE OF staff_id, status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_booking_staff_notifications();
