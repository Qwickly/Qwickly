-- ============================================================================
-- Migration 015: Client Notifications
-- Provides a queue-based system for client WhatsApp notifications
-- ============================================================================

-- ── 1. Create client_notifications table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'booking_confirmations', 'reminder_24h', 'reminder_2h', 'review_requests', 'cancellation_notices', 'rescheduling_alerts'
  )),
  message       TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for fast lookups by business, client, booking, status, and scheduled_at
CREATE INDEX IF NOT EXISTS client_notifications_business_id_idx 
  ON public.client_notifications(business_id);
CREATE INDEX IF NOT EXISTS client_notifications_client_id_idx 
  ON public.client_notifications(client_id);
CREATE INDEX IF NOT EXISTS client_notifications_status_idx 
  ON public.client_notifications(status);
CREATE INDEX IF NOT EXISTS client_notifications_booking_id_idx 
  ON public.client_notifications(booking_id);
CREATE INDEX IF NOT EXISTS client_notifications_scheduled_at_idx 
  ON public.client_notifications(scheduled_at);

-- Enable RLS and setup policy
ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_notifications_all_own" ON public.client_notifications;
CREATE POLICY "client_notifications_all_own" ON public.client_notifications
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Trigger for updating updated_at timestamp
DROP TRIGGER IF EXISTS client_notifications_updated_at ON public.client_notifications;
CREATE TRIGGER client_notifications_updated_at
  BEFORE UPDATE ON public.client_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. PL/pgSQL Function: manage_booking_client_notifications ──────────────

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
  -- Always delete existing pending/scheduled notifications for this booking first
  -- This prevents duplicate/outdated notifications if a booking is updated.
  DELETE FROM public.client_notifications
  WHERE booking_id = NEW.id AND status = 'pending';

  -- If status is 'no_show', we do not send any notifications
  IF NEW.status = 'no_show' THEN
    RETURN NEW;
  END IF;

  -- Load settings for this business to check if client notifications are enabled
  SELECT * INTO v_settings 
  FROM public.notification_settings 
  WHERE business_id = NEW.business_id;
  
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Load helper data
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

  -- Format date and time (South Africa SAST timezone: UTC+2)
  v_booking_date := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_booking_time := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- ── 1. Handle cancellation_notices notification ───────────────────────────
  -- Triggered on status transition to 'cancelled'
  IF NEW.status = 'cancelled' THEN
    IF v_settings.cancellation_notices AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'cancelled')) THEN
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been cancelled.';
      
      INSERT INTO public.client_notifications 
        (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
      VALUES 
        (NEW.business_id, NEW.id, NEW.client_id, 'cancellation_notices', v_msg, now(), 'pending');
    END IF;
    
    -- Stop scheduling other reminders for cancelled bookings
    RETURN NEW;
  END IF;

  -- ── 2. Handle rescheduling_alerts notification ────────────────────────────
  -- Triggered on UPDATE when start_time changes
  IF TG_OP = 'UPDATE' AND OLD.start_time != NEW.start_time AND v_settings.rescheduling_alerts THEN
    v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' has been rescheduled to ' || v_booking_date || ' at ' || v_booking_time || '.';
    
    INSERT INTO public.client_notifications 
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES 
      (NEW.business_id, NEW.id, NEW.client_id, 'rescheduling_alerts', v_msg, now(), 'pending');
  END IF;

  -- ── 3. Handle booking_confirmations notification ──────────────────────────
  -- Triggered on INSERT or when status becomes pending or confirmed
  IF v_settings.booking_confirmations THEN
    IF TG_OP = 'INSERT' OR 
       (TG_OP = 'UPDATE' AND OLD.status != NEW.status AND NEW.status IN ('pending', 'confirmed')) THEN
      
      v_msg := 'Hi ' || v_client_name || ', your booking for ' || v_service_name || ' on ' || v_booking_date || ' at ' || v_booking_time || ' has been confirmed. Thank you!';
      
      INSERT INTO public.client_notifications 
        (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
      VALUES 
        (NEW.business_id, NEW.id, NEW.client_id, 'booking_confirmations', v_msg, now(), 'pending');
    END IF;
  END IF;

  -- ── 4. Handle reminder_24h notification ───────────────────────────────────
  -- Triggered for confirmed bookings scheduled > 24 hours in the future
  IF v_settings.reminder_24h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', this is a reminder for your upcoming appointment for ' || v_service_name || ' with ' || v_staff_name || ' on ' || v_booking_date || ' at ' || v_booking_time || '. See you soon!';
    
    INSERT INTO public.client_notifications 
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES 
      (NEW.business_id, NEW.id, NEW.client_id, 'reminder_24h', v_msg, NEW.start_time - INTERVAL '24 hours', 'pending');
  END IF;

  -- ── 5. Handle reminder_2h notification ────────────────────────────────────
  -- Triggered for confirmed bookings scheduled > 2 hours in the future
  IF v_settings.reminder_2h AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := 'Hi ' || v_client_name || ', your appointment for ' || v_service_name || ' with ' || v_staff_name || ' starts in 2 hours (at ' || v_booking_time || '). See you soon!';
    
    INSERT INTO public.client_notifications 
      (business_id, booking_id, client_id, notification_type, message, scheduled_at, status)
    VALUES 
      (NEW.business_id, NEW.id, NEW.client_id, 'reminder_2h', v_msg, NEW.start_time - INTERVAL '2 hours', 'pending');
  END IF;

  -- ── 6. Handle review_requests notification ────────────────────────────────
  -- Triggered for confirmed or completed bookings, scheduled for 2 hours after end_time
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

-- ── 3. Attach Trigger to Bookings Table ──────────────────────────────────

DROP TRIGGER IF EXISTS trigger_manage_booking_client_notifications ON public.bookings;
CREATE TRIGGER trigger_manage_booking_client_notifications
  AFTER INSERT OR UPDATE OF start_time, end_time, status, service_id, client_id, staff_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_booking_client_notifications();
