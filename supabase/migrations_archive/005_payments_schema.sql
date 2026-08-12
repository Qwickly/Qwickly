-- Payment transactions (deposits, full payments, refunds)

CREATE TABLE IF NOT EXISTS public.payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  booking_id  UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('payfast', 'yoco', 'cash', 'eft')),
  status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'refunded', 'failed')),
  type        TEXT NOT NULL DEFAULT 'full_payment' CHECK (type IN ('deposit', 'full_payment', 'refund')),
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_business_id_idx ON public.payments(business_id);
CREATE INDEX IF NOT EXISTS payments_client_id_idx ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS payments_booking_id_idx ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON public.payments(paid_at);

DROP TRIGGER IF EXISTS payments_updated_at ON public.payments;
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_all_own" ON public.payments;
CREATE POLICY "payments_all_own" ON public.payments
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
