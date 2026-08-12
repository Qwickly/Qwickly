-- 038_allow_api_client_status.sql
-- Allow clients.status to be set to api for Meta-driven WhatsApp sends.

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check CHECK (status IN ('new', 'active', 'inactive', 'archived', 'api'));

UPDATE public.clients
SET status = COALESCE(NULLIF(status, ''), 'new')
WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
