-- 035_meta_whatsapp_messages.sql
-- Create table to persist WhatsApp send attempts and Graph responses

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_number_id text,
  to_phone text,
  message_id text,
  success boolean,
  response_payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_messages_business_id ON public.meta_whatsapp_messages(business_id);
