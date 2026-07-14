-- Store individual recipients for marketing campaigns to allow large batches

CREATE TABLE IF NOT EXISTS public.marketing_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_text TEXT NOT NULL, -- email address or phone (depending on campaign channel)
  recipient_type TEXT NOT NULL DEFAULT 'email' CHECK (recipient_type IN ('email','phone')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for DATE, -- date when this recipient is eligible to be sent
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_campaign_id_idx ON public.marketing_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_business_id_idx ON public.marketing_campaign_recipients(business_id);
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_status_idx ON public.marketing_campaign_recipients(status);
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_scheduled_for_idx ON public.marketing_campaign_recipients(scheduled_for);

DROP TRIGGER IF EXISTS marketing_campaign_recipients_updated_at ON public.marketing_campaign_recipients;
CREATE TRIGGER marketing_campaign_recipients_updated_at
  BEFORE UPDATE ON public.marketing_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_campaign_recipients_own" ON public.marketing_campaign_recipients
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
