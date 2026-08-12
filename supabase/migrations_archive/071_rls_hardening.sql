-- 071_rls_hardening.sql
-- Closes anonymous write access and SECURITY DEFINER exposure found in the
-- 2026-08-12 authorization review of all RLS policies, table grants and
-- functions. Idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Remove the "_system_" policies.
--
-- These were written as `roles={public}` with USING(true)/WITH CHECK(true),
-- intending to let the backend write. But the backend uses the service_role
-- key, which bypasses RLS entirely and never needed a policy. The practical
-- effect was granting anonymous INSERT/UPDATE to the whole internet.
--
-- Verified before dropping: the only writers are api-server modules
-- (engagement-tracker.ts, warmup-manager.ts, ab-test-manager.ts), all of which
-- use getSupabaseAdmin() -> service_role. No frontend or edge-function code
-- references these tables. The owner-scoped *_select_own / *_insert_own /
-- *_update_own policies are left intact.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS recipient_insights_system_insert  ON public.recipient_insights;
DROP POLICY IF EXISTS recipient_insights_system_update  ON public.recipient_insights;
DROP POLICY IF EXISTS number_warmup_system_insert       ON public.number_warmup;
DROP POLICY IF EXISTS number_warmup_system_update       ON public.number_warmup;
DROP POLICY IF EXISTS warmup_config_system_update       ON public.warmup_config;
DROP POLICY IF EXISTS ab_test_assignments_system_insert ON public.ab_test_assignments;
DROP POLICY IF EXISTS ab_test_assignments_system_update ON public.ab_test_assignments;

-- ---------------------------------------------------------------------------
-- 2. compute_available_slots: close the wrapper bypass.
--
-- get_business_booking_slots() guards with user_owns_business(), then delegates
-- here - but this function was independently granted to anon and checks
-- nothing, so calling it directly skipped the guard and exposed availability
-- for any business UUID, including unpublished booking pages.
--
-- Both callers (get_business_booking_slots, get_public_booking_slots) are
-- SECURITY DEFINER and execute as the owner, so they are unaffected.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.compute_available_slots(uuid, uuid, date, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed functions: no authorization check, arbitrary business_id.
--
-- Both are SECURITY DEFINER and accepted any business_id from any anonymous
-- caller. ON CONFLICT DO NOTHING prevented overwriting configured data, but a
-- caller could still pre-seed rows for an unconfigured business - including
-- whatsapp_bot_working_hours, which would make that tenant's bot answer on
-- hours they never set.
--
-- Revoking rather than adding an ownership check on purpose: handle_new_user()
-- calls these during signup, where auth.uid() is not reliably populated, so an
-- internal check could break account creation. Both callers (handle_new_user,
-- ensure_my_business) are SECURITY DEFINER and keep working.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.seed_business_defaults(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_bot_defaults(uuid)
  FROM PUBLIC, anon, authenticated;
