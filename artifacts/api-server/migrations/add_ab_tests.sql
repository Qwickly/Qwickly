-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A/B testing table
CREATE TABLE IF NOT EXISTS public.ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message_a TEXT NOT NULL,
  message_b TEXT NOT NULL,
  image_url_a TEXT,
  image_url_b TEXT,
  split_percentage INTEGER DEFAULT 50, -- Percentage for message A
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','cancelled')),
  winner TEXT CHECK (winner IN ('A','B','tie','inconclusive')),
  statistical_significance DECIMAL(5,4),
  sample_size_a INTEGER DEFAULT 0,
  sample_size_b INTEGER DEFAULT 0,
  conversions_a INTEGER DEFAULT 0,
  conversions_b INTEGER DEFAULT 0,
  opens_a INTEGER DEFAULT 0,
  opens_b INTEGER DEFAULT 0,
  responses_a INTEGER DEFAULT 0,
  responses_b INTEGER DEFAULT 0,
  conversion_rate_a DECIMAL(5,4),
  conversion_rate_b DECIMAL(5,4),
  open_rate_a DECIMAL(5,4),
  open_rate_b DECIMAL(5,4),
  response_rate_a DECIMAL(5,4),
  response_rate_b DECIMAL(5,4),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS ab_tests_business_id_idx ON public.ab_tests(business_id);
CREATE INDEX IF NOT EXISTS ab_tests_campaign_id_idx ON public.ab_tests(campaign_id);
CREATE INDEX IF NOT EXISTS ab_tests_status_idx ON public.ab_tests(status);

-- Row Level Security
ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own A/B tests
DROP POLICY IF EXISTS "ab_tests_select_own" ON public.ab_tests;
CREATE POLICY "ab_tests_select_own" ON public.ab_tests
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: Users can insert their own A/B tests
DROP POLICY IF EXISTS "ab_tests_insert_own" ON public.ab_tests;
CREATE POLICY "ab_tests_insert_own" ON public.ab_tests
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can update their own A/B tests
DROP POLICY IF EXISTS "ab_tests_update_own" ON public.ab_tests;
CREATE POLICY "ab_tests_update_own" ON public.ab_tests
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can delete their own A/B tests
DROP POLICY IF EXISTS "ab_tests_delete_own" ON public.ab_tests;
CREATE POLICY "ab_tests_delete_own" ON public.ab_tests
  FOR DELETE USING (public.user_owns_business(business_id));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS ab_tests_updated_at ON public.ab_tests;
CREATE TRIGGER ab_tests_updated_at
  BEFORE UPDATE ON public.ab_tests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- A/B test assignments table (tracks which variant each recipient got)
CREATE TABLE IF NOT EXISTS public.ab_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ab_test_id UUID NOT NULL REFERENCES public.ab_tests(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('A','B')),
  sent_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS ab_test_assignments_ab_test_id_idx ON public.ab_test_assignments(ab_test_id);
CREATE INDEX IF NOT EXISTS ab_test_assignments_recipient_phone_idx ON public.ab_test_assignments(recipient_phone);

-- Row Level Security
ALTER TABLE public.ab_test_assignments ENABLE ROW LEVEL SECURITY;

-- Policy: System can insert assignments
DROP POLICY IF EXISTS "ab_test_assignments_system_insert" ON public.ab_test_assignments;
CREATE POLICY "ab_test_assignments_system_insert" ON public.ab_test_assignments
  FOR INSERT WITH CHECK (true);

-- Policy: System can update assignments
DROP POLICY IF EXISTS "ab_test_assignments_system_update" ON public.ab_test_assignments;
CREATE POLICY "ab_test_assignments_system_update" ON public.ab_test_assignments
  FOR UPDATE USING (true)
  WITH CHECK (true);
