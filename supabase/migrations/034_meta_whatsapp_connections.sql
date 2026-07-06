-- Table to store Meta WhatsApp Embedded Signup connection data

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  whatsapp_business_account_id TEXT NOT NULL,
  meta_app_id TEXT,
  embedded_signup_config_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_whatsapp_connections_business_id_idx
  ON public.meta_whatsapp_connections(business_id);

CREATE TRIGGER meta_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.meta_whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
