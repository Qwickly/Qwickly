-- Usage tracking table for subscription limits and billing (daily tracking)

CREATE TABLE IF NOT EXISTS public.usage_tracking (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  tracking_date DATE NOT NULL, -- Track by day instead of period
  
  -- Marketing metrics
  marketing_messages_sent INTEGER NOT NULL DEFAULT 0,
  
  -- WhatsApp metrics
  whatsapp_messages_sent INTEGER NOT NULL DEFAULT 0,
  whatsapp_campaigns_sent INTEGER NOT NULL DEFAULT 0,
  
  -- Booking metrics
  bookings_created INTEGER NOT NULL DEFAULT 0,
  bookings_completed INTEGER NOT NULL DEFAULT 0,
  bookings_cancelled INTEGER NOT NULL DEFAULT 0,
  
  -- Client metrics
  clients_added INTEGER NOT NULL DEFAULT 0,
  
  -- Review metrics
  review_requests_sent INTEGER NOT NULL DEFAULT 0,
  reviews_received INTEGER NOT NULL DEFAULT 0,
  
  -- Additional metadata
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_tracking_business_id_idx ON public.usage_tracking(business_id);
CREATE INDEX IF NOT EXISTS usage_tracking_subscription_id_idx ON public.usage_tracking(subscription_id);
CREATE INDEX IF NOT EXISTS usage_tracking_date_idx ON public.usage_tracking(tracking_date);
CREATE UNIQUE INDEX IF NOT EXISTS usage_tracking_business_date_idx 
  ON public.usage_tracking(business_id, tracking_date);

DROP TRIGGER IF EXISTS usage_tracking_updated_at ON public.usage_tracking;
CREATE TRIGGER usage_tracking_updated_at
  BEFORE UPDATE ON public.usage_tracking
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_tracking_all_own" ON public.usage_tracking;
CREATE POLICY "usage_tracking_all_own" ON public.usage_tracking
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
