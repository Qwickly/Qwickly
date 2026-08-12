-- 075_deposit_settings_public_read.sql
-- Fixes a regression introduced by 074 and repairs a pre-existing bug it exposed.
--
-- BACKGROUND
--
-- 074 revoked all table privileges from `anon` and granted SELECT back on the
-- four tables the public booking page reads. That list was traced from
-- artifacts/bookza/src/lib/booking-page.ts — but from a checkout that predated
-- the deposits feature (commit 6ae8b8e, 2026-08-03). The current
-- fetchPublicBookingPage reads a FIFTH table, deposit_settings, which 074 did
-- not grant back.
--
-- Before 074:  anon had GRANT ALL on deposit_settings, but the table's only
--              policy is deposits_all_own (owner-scoped). So an anonymous
--              visitor got ZERO ROWS — no error. maybeSingle() returned
--              { data: null, error: null } and the page rendered fine, just
--              without business-wide deposit settings.
--
-- After 074:   the grant is gone, so PostgREST returns 42501 permission denied.
--              booking-page.ts:245 throws on depositRes.error, which means
--              fetchPublicBookingPage throws and EVERY published booking page
--              fails to load — not just the deposit section.
--
-- Run this as soon as possible: until it is applied, /book/:slug is down.

-- ---------------------------------------------------------------------------
-- 1. Restore the grant 074 should have included.
--
-- This alone is enough to bring the public booking page back up. With the grant
-- but no public policy, anon reads zero rows again — exactly the pre-074
-- behaviour, page loads, deposit settings absent.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.deposit_settings TO anon;

-- ---------------------------------------------------------------------------
-- 2. Let published booking pages actually read their deposit settings.
--
-- This part is a fix, not a restore: business-wide deposit settings have never
-- been visible to public visitors, because deposits_all_own is the only policy
-- on the table. Same latent bug 074 found on business_operating_hours, and the
-- policy below is scoped identically — published pages only.
--
-- The code clearly intends these to be public: fetchPublicBookingPage maps them
-- into PublicDepositSettings, and create_public_booking (SECURITY DEFINER, so
-- unaffected by any of this) already reads the same row to compute the deposit
-- it charges. Today the customer is quoted a deposit the page could not show.
--
-- Per-service deposits (services.deposit_required / deposit_amount) were never
-- affected — `services` is granted to anon and has a public-read policy.
--
-- If you would rather keep the strict "restore only" behaviour, drop this
-- section and keep step 1.
--
-- Only three columns matter to the page, but RLS is row-level; the columns on
-- this table (require_deposit, deposit_type, deposit_amount) carry nothing
-- sensitive.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS deposits_public_read ON public.deposit_settings;
CREATE POLICY deposits_public_read
  ON public.deposit_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.booking_page_settings bps
      WHERE bps.business_id = deposit_settings.business_id
        AND bps.is_published = true
    )
  );
