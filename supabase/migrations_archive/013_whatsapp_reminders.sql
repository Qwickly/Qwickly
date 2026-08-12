-- ============================================================================
-- Migration 013: WhatsApp Custom Reminders & Persisted Reminders Queue
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- ── 1. Add reminder customization settings to whatsapp_settings ──────────────

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_24h_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_24h_template TEXT NOT NULL DEFAULT 'Hi {client_name}, this is a reminder for your upcoming appointment for {service_name} with {staff_name} on {booking_date} at {booking_time}. See you soon!',
  ADD COLUMN IF NOT EXISTS reminder_2h_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_2h_template TEXT NOT NULL DEFAULT 'Hi {client_name}, your appointment for {service_name} with {staff_name} starts in 2 hours (at {booking_time}). See you soon!',
  ADD COLUMN IF NOT EXISTS confirmation_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS confirmation_template TEXT NOT NULL DEFAULT 'Hi {client_name}, your booking for {service_name} on {booking_date} at {booking_time} has been confirmed. Thank you!',
  ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_hours INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS follow_up_template TEXT NOT NULL DEFAULT 'Hi {client_name}, thanks for visiting us today! How was your appointment for {service_name}? We would love to hear your feedback!';

-- ── 2. Create whatsapp_reminders table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_reminders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id    UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'failed')),
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('confirmation', '24h', '2h', 'follow_up')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for fast lookups by business and scheduling times
CREATE INDEX IF NOT EXISTS whatsapp_reminders_business_id_idx ON public.whatsapp_reminders(business_id);
CREATE INDEX IF NOT EXISTS whatsapp_reminders_scheduled_at_idx ON public.whatsapp_reminders(scheduled_at);
CREATE INDEX IF NOT EXISTS whatsapp_reminders_booking_id_idx ON public.whatsapp_reminders(booking_id);

-- Enable RLS and setup policy
ALTER TABLE public.whatsapp_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reminders_all_own" ON public.whatsapp_reminders;
CREATE POLICY "reminders_all_own" ON public.whatsapp_reminders
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Trigger for updating updated_at timestamp
DROP TRIGGER IF EXISTS whatsapp_reminders_updated_at ON public.whatsapp_reminders;
CREATE TRIGGER whatsapp_reminders_updated_at
  BEFORE UPDATE ON public.whatsapp_reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Automated Reminder Scheduling PL/pgSQL Trigger Function ───────────────

CREATE OR REPLACE FUNCTION public.manage_booking_whatsapp_reminders()
RETURNS TRIGGER AS $$
DECLARE
  v_business_name TEXT;
  v_client_name TEXT;
  v_client_phone TEXT;
  v_service_name TEXT;
  v_staff_name TEXT;
  v_settings RECORD;
  v_date_str TEXT;
  v_time_str TEXT;
  v_msg TEXT;
BEGIN
  -- Always delete existing pending/scheduled reminders for this booking first
  DELETE FROM public.whatsapp_reminders
  WHERE booking_id = NEW.id AND status = 'scheduled';

  -- If the booking is cancelled or marked as no-show, do not schedule reminders
  IF NEW.status IN ('cancelled', 'no_show') THEN
    RETURN NEW;
  END IF;

  -- Load whatsapp settings for this business
  SELECT * INTO v_settings FROM public.whatsapp_settings WHERE business_id = NEW.business_id;
  IF NOT FOUND OR NOT v_settings.reminders_enabled THEN
    RETURN NEW;
  END IF;

  -- Load helper names for variable interpolation
  SELECT business_name INTO v_business_name FROM public.businesses WHERE id = NEW.business_id;
  SELECT name, phone INTO v_client_name, v_client_phone FROM public.clients WHERE id = NEW.client_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = NEW.service_id;
  
  IF NEW.staff_id IS NOT NULL THEN
    SELECT name INTO v_staff_name FROM public.staff_members WHERE id = NEW.staff_id;
  ELSE
    v_staff_name := 'Staff';
  END IF;

  -- Format date and time (defaulting to South Africa SAST timezone: UTC+2)
  v_date_str := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY');
  v_time_str := to_char(NEW.start_time AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');

  -- 1. Schedule Booking Confirmation message (sent immediately)
  IF v_settings.confirmation_enabled AND NEW.status IN ('pending', 'confirmed') THEN
    v_msg := v_settings.confirmation_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, now(), 'confirmation', 'scheduled');
  END IF;

  -- 2. Schedule 24-Hour Reminder
  IF v_settings.reminder_24h_enabled AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '24 hours') > now() THEN
    v_msg := v_settings.reminder_24h_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.start_time - INTERVAL '24 hours', '24h', 'scheduled');
  END IF;

  -- 3. Schedule 2-Hour Reminder
  IF v_settings.reminder_2h_enabled AND NEW.status = 'confirmed' AND (NEW.start_time - INTERVAL '2 hours') > now() THEN
    v_msg := v_settings.reminder_2h_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.start_time - INTERVAL '2 hours', '2h', 'scheduled');
  END IF;

  -- 4. Schedule Post-Appointment Follow-up / Review request
  IF v_settings.follow_up_enabled AND NEW.status IN ('confirmed', 'completed') THEN
    v_msg := v_settings.follow_up_template;
    v_msg := replace(v_msg, '{client_name}', v_client_name);
    v_msg := replace(v_msg, '{booking_date}', v_date_str);
    v_msg := replace(v_msg, '{booking_time}', v_time_str);
    v_msg := replace(v_msg, '{service_name}', v_service_name);
    v_msg := replace(v_msg, '{staff_name}', v_staff_name);
    v_msg := replace(v_msg, '{business_name}', v_business_name);

    INSERT INTO public.whatsapp_reminders (business_id, booking_id, client_id, message, scheduled_at, reminder_type, status)
    VALUES (NEW.business_id, NEW.id, NEW.client_id, v_msg, NEW.end_time + (v_settings.follow_up_hours * INTERVAL '1 hour'), 'follow_up', 'scheduled');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4. Attach Trigger to Bookings Table ──────────────────────────────────────

DROP TRIGGER IF EXISTS trigger_manage_booking_whatsapp_reminders ON public.bookings;
CREATE TRIGGER trigger_manage_booking_whatsapp_reminders
  AFTER INSERT OR UPDATE OF start_time, end_time, status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.manage_booking_whatsapp_reminders();
