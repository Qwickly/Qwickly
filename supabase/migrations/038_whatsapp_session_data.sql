-- Migration: whatsapp_session_data
-- Purpose: Persist WhatsApp LocalAuth session files across Railway container restarts.
-- The session archive contains raw WhatsApp auth credentials and must only be
-- accessed by the backend service role.

CREATE TABLE IF NOT EXISTS public.whatsapp_session_data (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL UNIQUE,
  session_archive TEXT        NOT NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_session_data_tenant_idx
  ON public.whatsapp_session_data (tenant_id);

DROP TRIGGER IF EXISTS whatsapp_session_data_updated_at ON public.whatsapp_session_data;
CREATE TRIGGER whatsapp_session_data_updated_at
  BEFORE UPDATE ON public.whatsapp_session_data
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_session_data ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_session_data'
      AND policyname = 'Deny anon access'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Deny anon access"
        ON public.whatsapp_session_data
        FOR ALL
        TO anon
        USING (false)
        WITH CHECK (false)
    $policy$;
  END IF;
END
$$;
