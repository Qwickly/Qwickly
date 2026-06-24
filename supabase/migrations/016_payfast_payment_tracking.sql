-- PayFast tracking metadata for matching provider callbacks to local payments.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_idx
  ON public.payments(provider_reference)
  WHERE provider_reference IS NOT NULL;

