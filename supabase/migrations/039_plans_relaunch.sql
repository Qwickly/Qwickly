-- Relaunch the plan catalog for the 2-plan model (Starter R99 / Team R199).
-- See pricing.md + billing-migration-plan.md (Phase 1).
--
-- NOTE: The seed plans from migration 018 (starter/growth/business) are NOT
-- present in this database anymore — only custom_* rows exist. So this migration
-- UPSERTS the fixed plans rather than assuming they exist.
--
-- reminderAllowance / campaignTokens / marketingEmails / dashboard / flags are
-- keys inside the existing `metadata` JSONB column (not table columns).

-- 1. Offer/visibility flags. Existing rows default to visible; overridden below.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS public    BOOLEAN NOT NULL DEFAULT true;

-- 2. Starter — R99. Upsert so it works whether or not the row exists.
INSERT INTO public.plans (id, name, price_cents, billing_interval, interval_count, trial_days, metadata, is_active, public)
VALUES (
  'starter_monthly', 'Starter', 9900, 'month', 1, 14,
  jsonb_build_object(
    'staff',             1,
    'reminderAllowance', 500,
    'campaignTokens',    50,
    'marketingEmails',   50,
    'dashboard',         'basic',
    'staffScheduling',   false,
    'aiAssistant',       false,
    'whatsappChatbot',   false
  ),
  true, true
)
ON CONFLICT (id) DO UPDATE
SET name        = EXCLUDED.name,
    price_cents = EXCLUDED.price_cents,
    trial_days  = EXCLUDED.trial_days,
    metadata    = EXCLUDED.metadata,
    is_active   = true,
    public      = true;

-- 3. Team — R199. Upsert.
INSERT INTO public.plans (id, name, price_cents, billing_interval, interval_count, trial_days, metadata, is_active, public)
VALUES (
  'team_monthly', 'Team', 19900, 'month', 1, 14,
  jsonb_build_object(
    'staff',             3,
    'reminderAllowance', 1500,
    'campaignTokens',    150,
    'marketingEmails',   150,
    'dashboard',         'full',
    'staffScheduling',   true,
    'aiAssistant',       false,
    'whatsappChatbot',   false
  ),
  true, true
)
ON CONFLICT (id) DO UPDATE
SET name        = EXCLUDED.name,
    price_cents = EXCLUDED.price_cents,
    trial_days  = EXCLUDED.trial_days,
    metadata    = EXCLUDED.metadata,
    is_active   = true,
    public      = true;

-- 4. Retire the old Growth/Business tiers from new selection if they exist
--    (kept, not dropped, because subscriptions.plan_id FK is ON DELETE RESTRICT).
UPDATE public.plans
SET public = false, is_active = false
WHERE id IN ('growth_monthly', 'business_monthly');

-- 5. Existing custom_* plans stay per-business and are never listed in the plan
--    picker. Flag them non-public so a future `WHERE public = true` filter in
--    fetchPlans() (Phase 3/4) excludes them without touching their subscriptions.
UPDATE public.plans
SET public = false
WHERE id LIKE 'custom\_%';
