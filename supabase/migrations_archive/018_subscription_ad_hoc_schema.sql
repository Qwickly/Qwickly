-- Subscription Management System with PayFast Ad Hoc Tokenization
-- This migration replaces the simple subscriptions table with a full SaaS subscription system

-- Drop old subscriptions table if it exists
DROP TABLE IF EXISTS public.subscriptions CASCADE;

-- Plans table - defines available subscription plans
CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY, -- e.g., 'starter_monthly', 'growth_monthly', 'business_monthly'
  name TEXT NOT NULL, -- e.g., 'Starter', 'Growth', 'Business'
  price_cents INTEGER NOT NULL, -- Price in cents (e.g., 40000 for R400)
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')),
  interval_count INTEGER NOT NULL DEFAULT 1, -- Number of intervals (e.g., 1 for monthly, 12 for yearly)
  trial_days INTEGER DEFAULT 0, -- Trial period in days
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional plan features/limits
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default plans
INSERT INTO public.plans (id, name, price_cents, billing_interval, interval_count, metadata) VALUES
  ('starter_monthly', 'Starter', 40000, 'month', 1, '{"locations": 1, "staff": 2, "bookings": 150, "marketingMessages": 10000}'::jsonb),
  ('growth_monthly', 'Growth', 150000, 'month', 1, '{"locations": 1, "staff": 8, "bookings": 1000, "marketingMessages": 50000}'::jsonb),
  ('business_monthly', 'Business', 500000, 'month', 1, '{"locations": 5, "staff": 30, "bookings": 5000, "marketingMessages": 200000}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Subscriptions table - tracks user subscriptions with PayFast Ad Hoc tokens
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing')),
  payfast_token TEXT, -- Ad Hoc token from PayFast for recurring charges
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  pending_plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL, -- For downgrades
  pending_cancel_at TIMESTAMPTZ, -- Scheduled cancellation date
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional subscription data
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_business_id_idx ON public.subscriptions(business_id);
CREATE INDEX IF NOT EXISTS subscriptions_plan_id_idx ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS subscriptions_current_period_end_idx ON public.subscriptions(current_period_end);
CREATE INDEX IF NOT EXISTS subscriptions_payfast_token_idx ON public.subscriptions(payfast_token) WHERE payfast_token IS NOT NULL;

-- Unique constraint: one active subscription per business
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_business_active_idx 
  ON public.subscriptions(business_id) 
  WHERE status = 'active';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for plans (read-only for authenticated users)
DROP POLICY IF EXISTS "plans_select_all" ON public.plans;
CREATE POLICY "plans_select_all" ON public.plans
  FOR SELECT USING (auth.role() = 'authenticated');

-- Policies for subscriptions
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (
    user_id = auth.uid() OR 
    public.user_owns_business(business_id)
  );

DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
CREATE POLICY "subscriptions_insert_own" ON public.subscriptions
  FOR INSERT WITH CHECK (
    user_id = auth.uid() OR 
    public.user_owns_business(business_id)
  );

DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
CREATE POLICY "subscriptions_update_own" ON public.subscriptions
  FOR UPDATE USING (
    user_id = auth.uid() OR 
    public.user_owns_business(business_id)
  );

DROP POLICY IF EXISTS "subscriptions_delete_own" ON public.subscriptions;
CREATE POLICY "subscriptions_delete_own" ON public.subscriptions
  FOR DELETE USING (
    user_id = auth.uid() OR 
    public.user_owns_business(business_id)
  );

-- Function to check if a business has an active subscription
CREATE OR REPLACE FUNCTION public.has_active_subscription(business_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = business_uuid
    AND status = 'active'
    AND cancel_at_period_end = false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
