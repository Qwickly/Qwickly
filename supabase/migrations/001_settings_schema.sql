-- ============================================================================
-- Bookza Settings Schema
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Businesses ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.businesses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '',
  industry      TEXT NOT NULL DEFAULT 'other',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  website_url   TEXT NOT NULL DEFAULT '',
  onboarding_completed     BOOLEAN NOT NULL DEFAULT false,
  onboarding_tabs_visited  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS businesses_user_id_idx ON public.businesses(user_id);

-- ── Operating hours (one row per day per business) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_operating_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day_name    TEXT NOT NULL CHECK (day_name IN (
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
  )),
  is_open     BOOLEAN NOT NULL DEFAULT false,
  open_time   TIME NOT NULL DEFAULT '08:00',
  close_time  TIME NOT NULL DEFAULT '18:00',
  UNIQUE (business_id, day_name)
);

CREATE INDEX IF NOT EXISTS business_operating_hours_business_id_idx
  ON public.business_operating_hours(business_id);

-- ── Notification settings (one row per business) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_settings (
  business_id            UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_confirmations    BOOLEAN NOT NULL DEFAULT false,
  reminder_24h             BOOLEAN NOT NULL DEFAULT false,
  reminder_2h              BOOLEAN NOT NULL DEFAULT false,
  review_requests          BOOLEAN NOT NULL DEFAULT false,
  cancellation_notices     BOOLEAN NOT NULL DEFAULT false,
  rescheduling_alerts      BOOLEAN NOT NULL DEFAULT false,
  staff_new_booking        BOOLEAN NOT NULL DEFAULT false,
  staff_cancellation       BOOLEAN NOT NULL DEFAULT false,
  staff_daily_summary      BOOLEAN NOT NULL DEFAULT false,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Payment providers ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_provider_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL CHECK (provider_key IN (
    'payfast','yoco','cash','eft','snapscan','ozow'
  )),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  connected   BOOLEAN NOT NULL DEFAULT false,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider_key)
);

CREATE INDEX IF NOT EXISTS payment_provider_settings_business_id_idx
  ON public.payment_provider_settings(business_id);

-- ── Deposit settings ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deposit_settings (
  business_id      UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  require_deposit  BOOLEAN NOT NULL DEFAULT false,
  deposit_type     TEXT NOT NULL DEFAULT 'percentage' CHECK (deposit_type IN ('percentage','fixed')),
  deposit_amount   NUMERIC(10,2) NOT NULL DEFAULT 30,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── WhatsApp settings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  business_id                   UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_number                  TEXT NOT NULL DEFAULT '',
  api_token                     TEXT NOT NULL DEFAULT '',
  is_connected                  BOOLEAN NOT NULL DEFAULT false,
  reminder_lead_hours           INTEGER NOT NULL DEFAULT 24 CHECK (reminder_lead_hours IN (2,12,24,48)),
  reply_hours_mode              TEXT NOT NULL DEFAULT '8-18' CHECK (reply_hours_mode IN ('8-18','7-20','24')),
  include_service_name          BOOLEAN NOT NULL DEFAULT false,
  include_staff_name            BOOLEAN NOT NULL DEFAULT false,
  send_confirmation_immediately BOOLEAN NOT NULL DEFAULT false,
  allow_cancel_via_whatsapp     BOOLEAN NOT NULL DEFAULT false,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Team members ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  perm_bookings  BOOLEAN NOT NULL DEFAULT true,
  perm_clients   BOOLEAN NOT NULL DEFAULT false,
  perm_payments  BOOLEAN NOT NULL DEFAULT false,
  perm_analytics BOOLEAN NOT NULL DEFAULT false,
  perm_settings  BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);

CREATE INDEX IF NOT EXISTS team_members_business_id_idx ON public.team_members(business_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON public.team_members(user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS businesses_updated_at ON public.businesses;
CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS payment_provider_settings_updated_at ON public.payment_provider_settings;
CREATE TRIGGER payment_provider_settings_updated_at
  BEFORE UPDATE ON public.payment_provider_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS deposit_settings_updated_at ON public.deposit_settings;
CREATE TRIGGER deposit_settings_updated_at
  BEFORE UPDATE ON public.deposit_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS whatsapp_settings_updated_at ON public.whatsapp_settings;
CREATE TRIGGER whatsapp_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS team_members_updated_at ON public.team_members;
CREATE TRIGGER team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Seed defaults for a new business ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_business_defaults(p_business_id UUID, p_owner_name TEXT, p_owner_email TEXT)
RETURNS VOID AS $$
DECLARE
  d TEXT;
  days TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  p TEXT;
  providers TEXT[] := ARRAY['payfast','yoco','cash','eft','snapscan','ozow'];
BEGIN
  -- Operating hours
  FOREACH d IN ARRAY days LOOP
    INSERT INTO public.business_operating_hours (business_id, day_name, is_open, open_time, close_time)
    VALUES (
      p_business_id,
      d,
      false,
      '08:00'::time,
      '18:00'::time
    )
    ON CONFLICT (business_id, day_name) DO NOTHING;
  END LOOP;

  -- Notifications
  INSERT INTO public.notification_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- Payment providers
  FOREACH p IN ARRAY providers LOOP
    INSERT INTO public.payment_provider_settings (business_id, provider_key, enabled, connected)
    VALUES (p_business_id, p, false, false)
    ON CONFLICT (business_id, provider_key) DO NOTHING;
  END LOOP;

  -- Deposits
  INSERT INTO public.deposit_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- WhatsApp
  INSERT INTO public.whatsapp_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- Owner team member
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

-- ── Auto-provision on signup ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_business_id UUID;
  owner_name TEXT;
BEGIN
  owner_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(CONCAT(
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      ' ',
      COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    )), ''),
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.businesses (
    user_id, business_name, industry, phone, email
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'business_type', 'other'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.email, '')
  )
  RETURNING id INTO new_business_id;

  PERFORM public.seed_business_defaults(new_business_id, owner_name, COALESCE(NEW.email, ''));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RLS: businesses owned by auth user ────────────────────────────────────────

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.user_owns_business(p_business_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id AND b.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- businesses
DROP POLICY IF EXISTS "businesses_select_own" ON public.businesses;
CREATE POLICY "businesses_select_own" ON public.businesses
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_insert_own" ON public.businesses;
CREATE POLICY "businesses_insert_own" ON public.businesses
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_update_own" ON public.businesses;
CREATE POLICY "businesses_update_own" ON public.businesses
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_delete_own" ON public.businesses;
CREATE POLICY "businesses_delete_own" ON public.businesses
  FOR DELETE USING (user_id = auth.uid());

-- child tables
DROP POLICY IF EXISTS "hours_all_own" ON public.business_operating_hours;
CREATE POLICY "hours_all_own" ON public.business_operating_hours
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "notifications_all_own" ON public.notification_settings;
CREATE POLICY "notifications_all_own" ON public.notification_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "payments_all_own" ON public.payment_provider_settings;
CREATE POLICY "payments_all_own" ON public.payment_provider_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "deposits_all_own" ON public.deposit_settings;
CREATE POLICY "deposits_all_own" ON public.deposit_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "whatsapp_all_own" ON public.whatsapp_settings;
CREATE POLICY "whatsapp_all_own" ON public.whatsapp_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "team_all_own" ON public.team_members;
CREATE POLICY "team_all_own" ON public.team_members
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- ── RPC: ensure business exists (for users created before migration) ────────────

CREATE OR REPLACE FUNCTION public.ensure_my_business()
RETURNS UUID AS $$
DECLARE
  existing_id UUID;
  new_id UUID;
  owner_name TEXT;
  owner_email TEXT;
BEGIN
  SELECT id INTO existing_id FROM public.businesses WHERE user_id = auth.uid();
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  SELECT
    COALESCE(
      NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
      split_part(email, '@', 1)
    ),
    email
  INTO owner_name, owner_email
  FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.businesses (user_id, business_name, industry, phone, email)
  VALUES (
    auth.uid(),
    COALESCE((SELECT raw_user_meta_data->>'business_name' FROM auth.users WHERE id = auth.uid()), ''),
    COALESCE((SELECT raw_user_meta_data->>'business_type' FROM auth.users WHERE id = auth.uid()), 'other'),
    COALESCE((SELECT raw_user_meta_data->>'phone' FROM auth.users WHERE id = auth.uid()), ''),
    COALESCE(owner_email, '')
  )
  RETURNING id INTO new_id;

  PERFORM public.seed_business_defaults(new_id, owner_name, owner_email);
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.ensure_my_business() TO authenticated;
