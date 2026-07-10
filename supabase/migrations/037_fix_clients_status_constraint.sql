-- 037_fix_clients_status_constraint.sql
-- Fix clients.status constraint so it allows the new default value.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

UPDATE public.clients
SET status = 'new'
WHERE status IS NULL OR status = '';

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check CHECK (status IN ('new', 'active', 'inactive', 'archived', 'api'));

CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
