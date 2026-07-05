-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Scheduled campaigns table
CREATE TABLE IF NOT EXISTS public.scheduled_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  recipient_ids TEXT[] NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','cancelled','failed')),
  enable_anti_fingerprinting BOOLEAN DEFAULT true,
  batch_size INTEGER DEFAULT 100,
  batch_delay_minutes INTEGER DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS scheduled_campaigns_business_id_idx ON public.scheduled_campaigns(business_id);
CREATE INDEX IF NOT EXISTS scheduled_campaigns_status_idx ON public.scheduled_campaigns(status);
CREATE INDEX IF NOT EXISTS scheduled_campaigns_scheduled_for_idx ON public.scheduled_campaigns(scheduled_for);

-- Row Level Security
ALTER TABLE public.scheduled_campaigns ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own scheduled campaigns
DROP POLICY IF EXISTS "scheduled_campaigns_select_own" ON public.scheduled_campaigns;
CREATE POLICY "scheduled_campaigns_select_own" ON public.scheduled_campaigns
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: Users can insert their own scheduled campaigns
DROP POLICY IF EXISTS "scheduled_campaigns_insert_own" ON public.scheduled_campaigns;
CREATE POLICY "scheduled_campaigns_insert_own" ON public.scheduled_campaigns
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can update their own scheduled campaigns
DROP POLICY IF EXISTS "scheduled_campaigns_update_own" ON public.scheduled_campaigns;
CREATE POLICY "scheduled_campaigns_update_own" ON public.scheduled_campaigns
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can delete their own scheduled campaigns
DROP POLICY IF EXISTS "scheduled_campaigns_delete_own" ON public.scheduled_campaigns;
CREATE POLICY "scheduled_campaigns_delete_own" ON public.scheduled_campaigns
  FOR DELETE USING (public.user_owns_business(business_id));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS scheduled_campaigns_updated_at ON public.scheduled_campaigns;
CREATE TRIGGER scheduled_campaigns_updated_at
  BEFORE UPDATE ON public.scheduled_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
