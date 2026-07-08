-- Comprehensive fix: Allow clients to be deleted while keeping bookings/payments history.
-- Changes ON DELETE RESTRICT → ON DELETE SET NULL for all client foreign keys.

-- First, ensure columns are nullable
ALTER TABLE public.bookings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;

-- Drop existing RESTRICT constraints
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_client_id_fkey;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_fkey;

-- Add new SET NULL constraints
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
