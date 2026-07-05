-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Message engagement tracking table
CREATE TABLE IF NOT EXISTS public.message_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  scheduled_campaign_id UUID REFERENCES public.scheduled_campaigns(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response_time_seconds INTEGER,
  response_text TEXT,
  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  conversion_value DECIMAL(10,2),
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS message_engagement_business_id_idx ON public.message_engagement(business_id);
CREATE INDEX IF NOT EXISTS message_engagement_campaign_id_idx ON public.message_engagement(campaign_id);
CREATE INDEX IF NOT EXISTS message_engagement_recipient_phone_idx ON public.message_engagement(recipient_phone);
CREATE INDEX IF NOT EXISTS message_engagement_sent_at_idx ON public.message_engagement(sent_at);
CREATE INDEX IF NOT EXISTS message_engagement_responded_at_idx ON public.message_engagement(responded_at);

-- Row Level Security
ALTER TABLE public.message_engagement ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own engagement data
DROP POLICY IF EXISTS "message_engagement_select_own" ON public.message_engagement;
CREATE POLICY "message_engagement_select_own" ON public.message_engagement
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: Users can insert their own engagement data
DROP POLICY IF EXISTS "message_engagement_insert_own" ON public.message_engagement;
CREATE POLICY "message_engagement_insert_own" ON public.message_engagement
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can update their own engagement data
DROP POLICY IF EXISTS "message_engagement_update_own" ON public.message_engagement;
CREATE POLICY "message_engagement_update_own" ON public.message_engagement
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS message_engagement_updated_at ON public.message_engagement;
CREATE TRIGGER message_engagement_updated_at
  BEFORE UPDATE ON public.message_engagement
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Recipient insights table (aggregated engagement data)
CREATE TABLE IF NOT EXISTS public.recipient_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_opened INTEGER DEFAULT 0,
  total_responses INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_conversion_value DECIMAL(10,2) DEFAULT 0,
  avg_response_time_seconds INTEGER,
  best_send_hour INTEGER, -- 0-23, best hour to send
  best_send_day TEXT, -- Monday, Tuesday, etc.
  engagement_score DECIMAL(3,2) DEFAULT 0, -- 0-1 score
  last_contacted_at TIMESTAMPTZ,
  last_responded_at TIMESTAMPTZ,
  timezone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, recipient_phone)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS recipient_insights_business_id_idx ON public.recipient_insights(business_id);
CREATE INDEX IF NOT EXISTS recipient_insights_recipient_phone_idx ON public.recipient_insights(recipient_phone);
CREATE INDEX IF NOT EXISTS recipient_insights_engagement_score_idx ON public.recipient_insights(engagement_score DESC);

-- Row Level Security
ALTER TABLE public.recipient_insights ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own insights
DROP POLICY IF EXISTS "recipient_insights_select_own" ON public.recipient_insights;
CREATE POLICY "recipient_insights_select_own" ON public.recipient_insights
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: System can insert/update insights
DROP POLICY IF EXISTS "recipient_insights_system_insert" ON public.recipient_insights;
CREATE POLICY "recipient_insights_system_insert" ON public.recipient_insights
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "recipient_insights_system_update" ON public.recipient_insights;
CREATE POLICY "recipient_insights_system_update" ON public.recipient_insights
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS recipient_insights_updated_at ON public.recipient_insights;
CREATE TRIGGER recipient_insights_updated_at
  BEFORE UPDATE ON public.recipient_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
