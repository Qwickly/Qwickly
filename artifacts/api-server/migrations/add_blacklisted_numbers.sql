-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Blacklisted numbers table
CREATE TABLE IF NOT EXISTS public.blacklisted_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  reason TEXT NOT NULL,
  blacklisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, phone)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS blacklisted_numbers_business_id_idx ON public.blacklisted_numbers(business_id);
CREATE INDEX IF NOT EXISTS blacklisted_numbers_phone_idx ON public.blacklisted_numbers(phone);
CREATE INDEX IF NOT EXISTS blacklisted_numbers_blacklisted_at_idx ON public.blacklisted_numbers(blacklisted_at);

-- Row Level Security
ALTER TABLE public.blacklisted_numbers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Businesses can view their own blacklisted numbers"
  ON public.blacklisted_numbers FOR SELECT
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

CREATE POLICY "Businesses can insert their own blacklisted numbers"
  ON public.blacklisted_numbers FOR INSERT
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

CREATE POLICY "Businesses can update their own blacklisted numbers"
  ON public.blacklisted_numbers FOR UPDATE
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

CREATE POLICY "Businesses can delete their own blacklisted numbers"
  ON public.blacklisted_numbers FOR DELETE
  USING (business_id IN (SELECT id FROM public.businesses WHERE user_id = auth.uid()));

-- Trigger to auto-update updated_at
CREATE TRIGGER update_blacklisted_numbers_updated_at
  BEFORE UPDATE ON public.blacklisted_numbers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
