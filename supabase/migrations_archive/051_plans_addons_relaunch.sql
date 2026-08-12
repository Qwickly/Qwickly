-- ============================================================================
-- Migration 051: One-plan relaunch + add-on catalog
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Moves the plan catalog from the 2-plan model (Starter R99 / Team R199, seeded
-- by migration 039) to the current model: ONE plan (Starter R129) + à-la-carte
-- add-ons. See pricing.md §1-§8 and §12.
--
-- Deliberately does NOT delete anything:
--   • The 63 custom_* plans are inert (nothing references them; 039 already set
--     public = false) and get swept once the new plans are working.
--   • team_monthly is retired by flag, not dropped — subscriptions.plan_id is
--     ON DELETE RESTRICT, and flagging is reversible.
--
-- Metadata conventions (all keys live in the existing `metadata` JSONB):
--   staff / logins            → seat limits. NULL means unlimited.
--   dashboard                 → 'basic' | 'full'
--   marketingEmailsPerMonth   → included monthly email credits (reset monthly)
--   includedTokens            → included monthly WhatsApp tokens (Starter: 0)
--   whatsappSession           → may connect a WhatsApp number (base plan now)
--   whatsappTransactional     → 'unlimited' (fair use enforced in code, not here)
--   grants                    → plan-level add-on grants. Effective entitlement
--                               is (grants[x] = true) OR (a subscription_addons
--                               row exists for x). Lets dev_full_access hand out
--                               everything without fake add-on purchases.
-- ============================================================================

-- ── 1. Starter — R129, new metadata shape ────────────────────────────────────
-- Upsert so this works whether or not 039 ran against this database.
INSERT INTO public.plans (
  id, name, price_cents, billing_interval, interval_count, trial_days,
  metadata, is_active, public
)
VALUES (
  'starter_monthly', 'Starter', 12900, 'month', 1, 14,
  jsonb_build_object(
    'staff',                   1,
    'logins',                  1,
    'dashboard',               'basic',
    'marketingEmailsPerMonth', 100,
    'includedTokens',          0,
    'whatsappSession',         true,
    'whatsappTransactional',   'unlimited',
    'grants', jsonb_build_object(
      'whatsapp_chatbot', false,
      'analytics',        false,
      'branded_email',    false,
      'ai_assistant',     false,
      'custom_domain',    false
    )
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

-- ── 2. Retire Team — the current model has no Team plan ──────────────────────
-- Kept (not deleted) for FK integrity. Nothing references it today, but a
-- flag is reversible and a DELETE is not.
UPDATE public.plans
SET is_active = false, public = false
WHERE id = 'team_monthly';

-- ── 3. dev_full_access — internal comp plan, defined properly ────────────────
-- Was created by hand directly in the database and exists in no migration, so a
-- rebuilt DB would lose it — and it is the plan the team's own subscriptions
-- ride on. INSERT makes it reproducible; the ON CONFLICT branch deliberately
-- touches ONLY metadata/flags, leaving whatever name + price_cents the live row
-- already has untouched.
INSERT INTO public.plans (
  id, name, price_cents, billing_interval, interval_count, trial_days,
  metadata, is_active, public
)
VALUES (
  'dev_full_access', 'Dev Full Access', 0, 'month', 1, 0,
  jsonb_build_object(
    'staff',                   NULL,      -- unlimited
    'logins',                  NULL,      -- unlimited
    'dashboard',               'full',
    'marketingEmailsPerMonth', NULL,      -- unlimited
    'includedTokens',          NULL,      -- unlimited
    'whatsappSession',         true,
    'whatsappTransactional',   'unlimited',
    'grants', jsonb_build_object(
      'whatsapp_chatbot', true,
      'analytics',        true,
      'branded_email',    true,
      'ai_assistant',     true,
      'custom_domain',    true
    )
  ),
  true,
  false      -- internal: never listed in the plan picker
)
ON CONFLICT (id) DO UPDATE
SET metadata  = EXCLUDED.metadata,
    is_active = true,
    public    = false;

-- ── 4. Add-on catalog ────────────────────────────────────────────────────────
-- is_active = purchasable.  public = visible on the pricing page.
-- "Coming soon" = public true + is_active false (shown, not buyable).
CREATE TABLE IF NOT EXISTS public.plan_addons (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  max_quantity INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  public       BOOLEAN NOT NULL DEFAULT true,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.plan_addons (id, name, price_cents, max_quantity, is_active, public, metadata) VALUES
  ('whatsapp_chatbot', 'WhatsApp Chatbot',     20000,  1, true,  true, '{}'::jsonb),
  ('analytics',        'Analytics',            10000,  1, true,  true, '{}'::jsonb),
  ('branded_email',    'Branded Email Sender',  1500,  1, true,  true, '{}'::jsonb),
  -- Additional Staff: each unit adds 1 bookable staff seat. Applies to every
  -- plan (there is no Team-only restriction any more).
  ('extra_staff',      'Additional Staff',      2000, 50, true,  true,
     jsonb_build_object('grantsSeat', 'staff', 'seatsPerUnit', 1)),
  -- Coming soon: visible, not purchasable, price not yet set.
  ('ai_assistant',     'AI Assistant',              0, 1, false, true, '{}'::jsonb),
  ('custom_domain',    'Custom Booking Domain',     0, 1, false, true, '{}'::jsonb)
ON CONFLICT (id) DO UPDATE
SET name         = EXCLUDED.name,
    price_cents  = EXCLUDED.price_cents,
    max_quantity = EXCLUDED.max_quantity,
    is_active    = EXCLUDED.is_active,
    public       = EXCLUDED.public,
    metadata     = EXCLUDED.metadata;

DROP TRIGGER IF EXISTS plan_addons_updated_at ON public.plan_addons;
CREATE TRIGGER plan_addons_updated_at
  BEFORE UPDATE ON public.plan_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. Per-subscription add-ons ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_addons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  addon_id        TEXT NOT NULL REFERENCES public.plan_addons(id) ON DELETE RESTRICT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, addon_id)
);

CREATE INDEX IF NOT EXISTS subscription_addons_subscription_id_idx
  ON public.subscription_addons(subscription_id);

DROP TRIGGER IF EXISTS subscription_addons_updated_at ON public.subscription_addons;
CREATE TRIGGER subscription_addons_updated_at
  BEFORE UPDATE ON public.subscription_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.plan_addons ENABLE ROW LEVEL SECURITY;

-- The catalog is public reference data (the pricing page reads it while logged out).
DROP POLICY IF EXISTS "plan_addons_select_all" ON public.plan_addons;
CREATE POLICY "plan_addons_select_all" ON public.plan_addons
  FOR SELECT USING (true);
-- No write policies: only the service role (edge function) may change the catalog.

ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;

-- Owners may READ their own add-ons...
DROP POLICY IF EXISTS "subscription_addons_select_own" ON public.subscription_addons;
CREATE POLICY "subscription_addons_select_own" ON public.subscription_addons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_addons.subscription_id
        AND public.user_owns_business(s.business_id)
    )
  );

-- ...but NOT write them. Attaching an add-on charges money and must be priced
-- server-side from plan_addons, so writes go through the service role only.
-- (Deliberately no INSERT/UPDATE/DELETE policy — this is the entitlement
-- equivalent of the client-trusted finalPrice bug in the custom builder.)
