-- Opt-in defaults: new businesses start with toggles off until the owner configures them.

ALTER TABLE public.business_operating_hours
  ALTER COLUMN is_open SET DEFAULT false;

ALTER TABLE public.notification_settings
  ALTER COLUMN booking_confirmations SET DEFAULT false,
  ALTER COLUMN reminder_24h SET DEFAULT false,
  ALTER COLUMN review_requests SET DEFAULT false,
  ALTER COLUMN cancellation_notices SET DEFAULT false,
  ALTER COLUMN rescheduling_alerts SET DEFAULT false,
  ALTER COLUMN staff_new_booking SET DEFAULT false,
  ALTER COLUMN staff_cancellation SET DEFAULT false;

ALTER TABLE public.deposit_settings
  ALTER COLUMN require_deposit SET DEFAULT false;

ALTER TABLE public.whatsapp_settings
  ALTER COLUMN include_service_name SET DEFAULT false,
  ALTER COLUMN include_staff_name SET DEFAULT false,
  ALTER COLUMN send_confirmation_immediately SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.seed_business_defaults(p_business_id UUID, p_owner_name TEXT, p_owner_email TEXT)
RETURNS VOID AS $$
DECLARE
  d TEXT;
  days TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  p TEXT;
  providers TEXT[] := ARRAY['payfast','yoco','cash','eft','snapscan','ozow'];
BEGIN
  FOREACH d IN ARRAY days LOOP
    INSERT INTO public.business_operating_hours (business_id, day_name, is_open, open_time, close_time)
    VALUES (p_business_id, d, false, '08:00'::time, '18:00'::time)
    ON CONFLICT (business_id, day_name) DO NOTHING;
  END LOOP;

  INSERT INTO public.notification_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  FOREACH p IN ARRAY providers LOOP
    INSERT INTO public.payment_provider_settings (business_id, provider_key, enabled, connected)
    VALUES (p_business_id, p, false, false)
    ON CONFLICT (business_id, provider_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.deposit_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO public.whatsapp_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO public.team_members (
    business_id, name, email, role,
    perm_bookings, perm_clients, perm_payments, perm_analytics, perm_settings
  )
  VALUES (
    p_business_id, p_owner_name, p_owner_email, 'owner',
    true, true, true, true, true
  )
  ON CONFLICT (business_id, email) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reset seeded toggles for accounts still in first-time setup
UPDATE public.notification_settings ns
SET
  booking_confirmations = false,
  reminder_24h = false,
  reminder_2h = false,
  review_requests = false,
  cancellation_notices = false,
  rescheduling_alerts = false,
  staff_new_booking = false,
  staff_cancellation = false,
  staff_daily_summary = false
FROM public.businesses b
WHERE ns.business_id = b.id AND b.onboarding_completed = false;

UPDATE public.payment_provider_settings pps
SET enabled = false, connected = false
FROM public.businesses b
WHERE pps.business_id = b.id AND b.onboarding_completed = false;

UPDATE public.deposit_settings ds
SET require_deposit = false
FROM public.businesses b
WHERE ds.business_id = b.id AND b.onboarding_completed = false;

UPDATE public.whatsapp_settings ws
SET
  include_service_name = false,
  include_staff_name = false,
  send_confirmation_immediately = false,
  allow_cancel_via_whatsapp = false
FROM public.businesses b
WHERE ws.business_id = b.id AND b.onboarding_completed = false;

UPDATE public.business_operating_hours oh
SET is_open = false
FROM public.businesses b
WHERE oh.business_id = b.id AND b.onboarding_completed = false;
