ALTER TABLE public.meta_whatsapp_connections
ADD COLUMN IF NOT EXISTS phone_number_id TEXT;

COMMENT ON COLUMN public.meta_whatsapp_connections.phone_number_id IS
  'Phone number ID for Meta WhatsApp Cloud API sends, saved from the manual connection form.';
