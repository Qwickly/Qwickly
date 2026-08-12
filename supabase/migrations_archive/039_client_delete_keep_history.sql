-- Allow clients to be removed while keeping bookings/payments history intact.
-- Related booking/payment rows will keep their history but lose the client link.

ALTER TABLE public.bookings
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.payments
  ALTER COLUMN client_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'bookings'
      AND constraint_name = 'bookings_client_id_fkey'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_client_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'payments'
      AND constraint_name = 'payments_client_id_fkey'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_client_id_fkey;
  END IF;
END $$;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES public.clients(id)
  ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES public.clients(id)
  ON DELETE SET NULL;
