-- ============================================================================
-- Migration 012: WhatsApp AI Bot Settings
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Three tables:
--   1. whatsapp_bot_settings  — bot behaviour toggles + personality (1 row per business)
--   2. whatsapp_bot_working_hours — per-day open/close config   (7 rows per business)
--   3. whatsapp_bot_allowed_services — which services the bot may book (N rows per business)
-- ============================================================================

-- ── 1. Bot behaviour + personality ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_settings (
  business_id           UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- behaviour toggles
  bot_enabled           BOOLEAN NOT NULL DEFAULT true,
  auto_confirm          BOOLEAN NOT NULL DEFAULT false,
  accept_cancellations  BOOLEAN NOT NULL DEFAULT true,
  send_payment_links    BOOLEAN NOT NULL DEFAULT true,
  answer_faqs           BOOLEAN NOT NULL DEFAULT true,
  always_on             BOOLEAN NOT NULL DEFAULT false,
  -- personality
  tone                  TEXT NOT NULL DEFAULT 'friendly'
                          CHECK (tone IN ('friendly','professional','casual','concise')),
  bot_name              TEXT NOT NULL DEFAULT 'Bookza Assistant',
  welcome_message       TEXT NOT NULL DEFAULT 'Hi! 👋 How can I help you today?',
  fallback_message      TEXT NOT NULL DEFAULT 'I''ll pass you to a human who can help. Please hold! 🙏',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS whatsapp_bot_settings_updated_at ON public.whatsapp_bot_settings;
CREATE TRIGGER whatsapp_bot_settings_updated_at
  BEFORE UPDATE ON public.whatsapp_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_bot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_settings_all_own" ON public.whatsapp_bot_settings;
CREATE POLICY "bot_settings_all_own" ON public.whatsapp_bot_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- ── 2. Bot working hours (one row per day per business) ──────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_working_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  day_name     TEXT NOT NULL CHECK (day_name IN (
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
  )),
  is_open      BOOLEAN NOT NULL DEFAULT true,
  open_time    TIME NOT NULL DEFAULT '08:00',
  close_time   TIME NOT NULL DEFAULT '18:00',
  UNIQUE (business_id, day_name)
);

CREATE INDEX IF NOT EXISTS whatsapp_bot_working_hours_business_id_idx
  ON public.whatsapp_bot_working_hours(business_id);

ALTER TABLE public.whatsapp_bot_working_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_hours_all_own" ON public.whatsapp_bot_working_hours;
CREATE POLICY "bot_hours_all_own" ON public.whatsapp_bot_working_hours
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- ── 3. Bot allowed services (junction: business ↔ service) ──────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_allowed_services (
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_id   UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (business_id, service_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_bot_allowed_services_business_id_idx
  ON public.whatsapp_bot_allowed_services(business_id);

ALTER TABLE public.whatsapp_bot_allowed_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_allowed_services_all_own" ON public.whatsapp_bot_allowed_services;
CREATE POLICY "bot_allowed_services_all_own" ON public.whatsapp_bot_allowed_services
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- ── Seed helper: initialise bot defaults for a business ─────────────────────
-- Called from seed_business_defaults if re-run, or standalone for existing businesses.

CREATE OR REPLACE FUNCTION public.seed_bot_defaults(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
  d TEXT;
  days TEXT[] := ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
BEGIN
  -- Bot settings row
  INSERT INTO public.whatsapp_bot_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- Working hours rows (sensible defaults: Mon–Fri 08–18, Sat 08–15, Sun closed)
  FOREACH d IN ARRAY days LOOP
    INSERT INTO public.whatsapp_bot_working_hours (business_id, day_name, is_open, open_time, close_time)
    VALUES (
      p_business_id,
      d,
      CASE
        WHEN d IN ('monday','tuesday','wednesday','thursday','friday') THEN true
        WHEN d = 'saturday' THEN true
        ELSE false
      END,
      CASE WHEN d = 'sunday' THEN '09:00'::time ELSE '08:00'::time END,
      CASE
        WHEN d IN ('monday','tuesday','wednesday','thursday','friday') THEN '18:00'::time
        WHEN d = 'saturday' THEN '15:00'::time
        ELSE '13:00'::time
      END
    )
    ON CONFLICT (business_id, day_name) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed existing businesses (idempotent — skips rows that already exist)
DO $$
DECLARE
  biz RECORD;
BEGIN
  FOR biz IN SELECT id FROM public.businesses LOOP
    PERFORM public.seed_bot_defaults(biz.id);
  END LOOP;
END;
$$;
