-- ============================================================================
-- Marketing Campaigns Schema
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('WhatsApp','Email','SMS')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed')),
  message TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  recipient_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_business_id_idx
  ON public.marketing_campaigns(business_id);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_campaigns_select_own" ON public.marketing_campaigns;
CREATE POLICY "marketing_campaigns_select_own" ON public.marketing_campaigns
  FOR SELECT USING (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "marketing_campaigns_insert_own" ON public.marketing_campaigns;
CREATE POLICY "marketing_campaigns_insert_own" ON public.marketing_campaigns
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "marketing_campaigns_update_own" ON public.marketing_campaigns;
CREATE POLICY "marketing_campaigns_update_own" ON public.marketing_campaigns
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "marketing_campaigns_delete_own" ON public.marketing_campaigns;
CREATE POLICY "marketing_campaigns_delete_own" ON public.marketing_campaigns
  FOR DELETE USING (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS marketing_campaigns_updated_at ON public.marketing_campaigns;
CREATE TRIGGER marketing_campaigns_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
