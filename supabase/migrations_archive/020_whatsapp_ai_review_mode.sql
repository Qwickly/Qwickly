-- ============================================================================
-- Migration 020: WhatsApp AI Review Mode Foundation
-- Adds opt-in review settings and a durable draft table for future approval flow.
-- Current/default behaviour remains automatic.
-- ============================================================================

ALTER TABLE public.whatsapp_bot_settings
  ADD COLUMN IF NOT EXISTS review_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (review_mode IN ('auto', 'draft_only', 'approval_required'));

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tenant_id            UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  inbound_message_id   UUID REFERENCES public.inbound_messages(id) ON DELETE SET NULL,
  remote_jid           TEXT NOT NULL,
  client_id            UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name          TEXT,
  client_phone         TEXT,
  inbound_message_text TEXT NOT NULL,
  suggested_reply      TEXT NOT NULL,
  decision_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'dismissed', 'sent', 'expired')),
  approved_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  sent_at              TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_ai_drafts_business_status_idx
  ON public.whatsapp_ai_drafts(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_ai_drafts_remote_jid_idx
  ON public.whatsapp_ai_drafts(business_id, remote_jid, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_ai_drafts_inbound_message_idx
  ON public.whatsapp_ai_drafts(inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS whatsapp_ai_drafts_updated_at ON public.whatsapp_ai_drafts;
CREATE TRIGGER whatsapp_ai_drafts_updated_at
  BEFORE UPDATE ON public.whatsapp_ai_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_ai_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_ai_drafts_all_own" ON public.whatsapp_ai_drafts;
CREATE POLICY "whatsapp_ai_drafts_all_own" ON public.whatsapp_ai_drafts
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
