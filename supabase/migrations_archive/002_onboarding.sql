-- Onboarding: first-login setup wizard tracked on businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_tabs_visited JSONB NOT NULL DEFAULT '[]'::jsonb;
