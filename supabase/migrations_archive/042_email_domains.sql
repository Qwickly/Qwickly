-- ============================================================================
-- Migration 042: Custom sending domains (SendGrid domain authentication)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Stage 2 of the email system: let a business send transactional email From its
-- OWN verified domain instead of the shared Qwickly domain.
--
-- Flow:
--   1. Owner enters their domain (e.g. "salon.co.za").
--   2. api-server calls SendGrid's domain-authentication API, which returns a
--      set of CNAME DNS records. We store them here (status = 'pending').
--   3. Owner adds those records at their DNS provider and clicks "Verify".
--   4. api-server asks SendGrid to validate; on success status → 'verified'.
--   5. ONLY a 'verified' row causes the worker to send From that domain
--      (<from_local_part>@<domain>). Until then, Stage 1 Qwickly-domain sending
--      is used (see email-sender.ts / notification-worker.ts).
--
-- "One custom domain per business" is an MVP product rule enforced in the route
-- logic (POST replaces any existing domain), NOT a hard DB constraint — a hard
-- UNIQUE(business_id) would permanently stop a business from ever changing or
-- keeping historical domains. The DB only prevents the same business registering
-- the exact same domain twice, via UNIQUE(business_id, domain).
--
-- Future note: if we later add a `deleted_at` (or an `is_active`) column to keep
-- historical domains, enforce a single *active* domain per business with a
-- partial unique index, e.g.
--   CREATE UNIQUE INDEX email_domains_one_active_per_business
--     ON public.email_domains (business_id) WHERE deleted_at IS NULL;
-- For now there's no such column, so UNIQUE(business_id, domain) + route logic.
--
-- Writes happen server-side via the service role; owners only get SELECT via RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_domains (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  domain             TEXT NOT NULL,
  -- SendGrid's whitelabel domain id (used to validate/delete the authentication).
  sendgrid_domain_id BIGINT,
  -- The CNAME records SendGrid returned, as [{ host, type, data, valid }].
  dns_records        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Mailbox to send from on the verified domain → "<from_local_part>@<domain>".
  from_local_part    TEXT NOT NULL DEFAULT 'bookings'
    CHECK (from_local_part <> '' AND from_local_part !~ '[@[:space:]]'),
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed')),
  last_error         TEXT,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent duplicate rows for the same (business, domain) pair, while still
  -- allowing a business to move between domains over time.
  UNIQUE (business_id, domain)
);

CREATE INDEX IF NOT EXISTS email_domains_business_id_idx
  ON public.email_domains(business_id);

ALTER TABLE public.email_domains ENABLE ROW LEVEL SECURITY;

-- Owners can read their own domain row. All mutations go through the api-server
-- (service role), which also performs the SendGrid calls — so no owner-facing
-- INSERT/UPDATE/DELETE policies.
DROP POLICY IF EXISTS "email_domains_select_own" ON public.email_domains;
CREATE POLICY "email_domains_select_own" ON public.email_domains
  FOR SELECT USING (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS email_domains_updated_at ON public.email_domains;
CREATE TRIGGER email_domains_updated_at
  BEFORE UPDATE ON public.email_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
