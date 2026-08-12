-- 074_restrict_anon_grants.sql
-- Restrict the anon role to the reads the public booking page actually needs.
--
-- Supabase's default grants gave anon INSERT, UPDATE, DELETE and TRUNCATE on
-- every table in public — 54 of them after 060 removed subscriptions. Nothing
-- was exploitable, because every table has RLS enabled and the policies are
-- sound, but it meant RLS was the *only* thing standing between an anonymous
-- caller and the entire database. Any table created without a policy is
-- world-writable the moment it exists.
--
-- That is not hypothetical: contact_submissions and payment_provider_credentials
-- were both created by hand outside migrations. They are safe purely because
-- they happened to end up with zero policies.
--
-- Grants and RLS should agree. anon needs to read four tables and call a handful
-- of RPCs; it does not need write access to anything.
--
-- Idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Take everything away.
--
-- This does NOT affect the public booking flow's writes. create_public_booking,
-- cancel_booking_by_manage_token and reschedule_booking_by_manage_token are all
-- SECURITY DEFINER: they execute as the function owner, so they need EXECUTE on
-- the function and no table grants at all. Function privileges are separate from
-- table privileges, so this statement does not touch them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Give back exactly the four reads the public booking page performs.
--
-- Traced from artifacts/bookza/src/lib/booking-page.ts#fetchPublicBookingPage,
-- which is the only unauthenticated data path. manage-booking.ts uses RPCs only.
-- `businesses` is deliberately excluded: booking-page.ts does read it, but only
-- in fetchBookingPageSettings, the authenticated owner path.
--
-- RLS still applies on top of these. The existing policies scope each one to
-- published booking pages, so SELECT here does not mean "read every row".
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.booking_page_settings    TO anon;
GRANT SELECT ON public.services                 TO anon;
GRANT SELECT ON public.staff_members            TO anon;
GRANT SELECT ON public.business_operating_hours TO anon;

-- ---------------------------------------------------------------------------
-- 3. Fix opening hours never showing on public booking pages.
--
-- Pre-existing bug, found while scoping this migration. fetchPublicBookingPage
-- reads business_operating_hours, but the only policy on that table is
-- hours_all_own (owner-scoped via user_owns_business), so an anonymous visitor
-- got zero rows and the page rendered no opening hours.
--
-- Bookings themselves were unaffected: get_public_booking_slots is
-- SECURITY DEFINER and reads the hours regardless.
--
-- Scoped to published pages only, matching services_public_read and
-- staff_public_read.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS hours_public_read ON public.business_operating_hours;
CREATE POLICY hours_public_read
  ON public.business_operating_hours
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.booking_page_settings bps
      WHERE bps.business_id = business_operating_hours.business_id
        AND bps.is_published = true
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Stop future tables from auto-granting to anon.
--
-- Without this, the next `CREATE TABLE` inherits the default privileges and
-- silently hands anon full DML again — which is how this situation arose.
--
-- Default privileges are per-creating-role, so this covers tables created by the
-- role running this migration. If tables are ever created by a different role,
-- repeat it for that role. It does not alter existing tables; step 1 did that.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
