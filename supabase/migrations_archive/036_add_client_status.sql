-- 036_add_client_status.sql
-- Add `status` column to clients table with allowed values and default

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

-- Set all existing client statuses to new
UPDATE public.clients
SET status = 'new'
WHERE status IS DISTINCT FROM 'new';

-- Ensure the status constraint includes the new value
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_status_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check CHECK (status IN ('new', 'active', 'inactive', 'archived'));

-- Optional: index to filter by status (useful for queries)
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
