-- Add columns to plans table for custom plan support
-- This adds the columns needed by the subscription-management Edge Function

-- Add description column
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS description TEXT;

-- Add interval column as alias for billing_interval
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS interval TEXT;

-- Copy billing_interval to interval for existing records
UPDATE public.plans SET interval = billing_interval WHERE interval IS NULL;

-- Add features column if it doesn't exist (metadata already exists but we want a dedicated features column)
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS features JSONB;

-- Copy metadata to features for existing records
UPDATE public.plans SET features = metadata WHERE features IS NULL;
