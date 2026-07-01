-- ============================================================================
-- Migration 031: WhatsApp bot knowledge base (FAQs)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Business-authored question/answer pairs the bot may use to answer general
-- (non-booking) questions. Injected into the bot's context as DATA only — never
-- as instructions, and never able to influence booking/price/hours/availability
-- (those come from structured tables and are validated server-side).
--
-- Length caps are enforced at the DB level too, so the injected context stays
-- bounded no matter what the UI sends:
--   • question ≤ 200 chars
--   • answer   ≤ 600 chars
-- A per-business count cap is enforced in the app layer (easier to tier by plan).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_faqs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  question     TEXT NOT NULL DEFAULT '' CHECK (char_length(question) <= 200),
  answer       TEXT NOT NULL DEFAULT '' CHECK (char_length(answer) <= 600),
  position     INTEGER NOT NULL DEFAULT 0,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_bot_faqs_business_id_idx
  ON public.whatsapp_bot_faqs(business_id);

ALTER TABLE public.whatsapp_bot_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_faqs_all_own" ON public.whatsapp_bot_faqs;
CREATE POLICY "bot_faqs_all_own" ON public.whatsapp_bot_faqs
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS whatsapp_bot_faqs_updated_at ON public.whatsapp_bot_faqs;
CREATE TRIGGER whatsapp_bot_faqs_updated_at
  BEFORE UPDATE ON public.whatsapp_bot_faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
