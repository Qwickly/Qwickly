-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Number warm-up tracking table
CREATE TABLE IF NOT EXISTS public.number_warmup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  day_number INTEGER NOT NULL, -- Day 1-6 of warm-up
  messages_sent INTEGER DEFAULT 0,
  messages_successful INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, tenant_id, day_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS number_warmup_business_id_idx ON public.number_warmup(business_id);
CREATE INDEX IF NOT EXISTS number_warmup_tenant_id_idx ON public.number_warmup(tenant_id);
CREATE INDEX IF NOT EXISTS number_warmup_status_idx ON public.number_warmup(status);

-- Row Level Security
ALTER TABLE public.number_warmup ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own warm-up data
DROP POLICY IF EXISTS "number_warmup_select_own" ON public.number_warmup;
CREATE POLICY "number_warmup_select_own" ON public.number_warmup
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: System can insert warm-up data
DROP POLICY IF EXISTS "number_warmup_system_insert" ON public.number_warmup;
CREATE POLICY "number_warmup_system_insert" ON public.number_warmup
  FOR INSERT WITH CHECK (true);

-- Policy: System can update warm-up data
DROP POLICY IF EXISTS "number_warmup_system_update" ON public.number_warmup;
CREATE POLICY "number_warmup_system_update" ON public.number_warmup
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS number_warmup_updated_at ON public.number_warmup;
CREATE TRIGGER number_warmup_updated_at
  BEFORE UPDATE ON public.number_warmup
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Warm-up configuration table
CREATE TABLE IF NOT EXISTS public.warmup_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  current_day INTEGER DEFAULT 0,
  warm_up_started_at TIMESTAMPTZ,
  warm_up_completed_at TIMESTAMPTZ,
  daily_targets JSONB DEFAULT '{
    "day1": 5,
    "day2": 10,
    "day3": 20,
    "day4": 40,
    "day5": 80,
    "day6": 100
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, tenant_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS warmup_config_business_id_idx ON public.warmup_config(business_id);
CREATE INDEX IF NOT EXISTS warmup_config_tenant_id_idx ON public.warmup_config(tenant_id);

-- Row Level Security
ALTER TABLE public.warmup_config ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own config
DROP POLICY IF EXISTS "warmup_config_select_own" ON public.warmup_config;
CREATE POLICY "warmup_config_select_own" ON public.warmup_config
  FOR SELECT USING (public.user_owns_business(business_id));

-- Policy: Users can insert their own config
DROP POLICY IF EXISTS "warmup_config_insert_own" ON public.warmup_config;
CREATE POLICY "warmup_config_insert_own" ON public.warmup_config
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

-- Policy: Users can update their own config
DROP POLICY IF EXISTS "warmup_config_update_own" ON public.warmup_config;
CREATE POLICY "warmup_config_update_own" ON public.warmup_config
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

-- Policy: System can update config
DROP POLICY IF EXISTS "warmup_config_system_update" ON public.warmup_config;
CREATE POLICY "warmup_config_system_update" ON public.warmup_config
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS warmup_config_updated_at ON public.warmup_config;
CREATE TRIGGER warmup_config_updated_at
  BEFORE UPDATE ON public.warmup_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
