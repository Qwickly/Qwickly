-- 072_subscription_privilege_escalation.sql
-- Closes a confirmed paid-tier bypass found in the 2026-08-12 authorization
-- review. Idempotent and safe to re-run.
--
-- THE BUG
-- `subscriptions_update_own` authorises on row ownership:
--     USING ((user_id = auth.uid()) OR user_owns_business(business_id))
-- RLS in Postgres is row-level, not column-level, so that predicate can express
-- "this row is yours" but not "you may not change plan_id". Combined with the
-- blanket UPDATE grant held by `authenticated`, any logged-in user could:
--
--     PATCH /rest/v1/subscriptions?id=eq.<their-own-sub>
--     { "plan_id": "<most expensive plan>", "status": "active" }
--
-- Verified live on 2026-08-12 (inside a rolled-back transaction): the update
-- succeeded, moving the row to the highest-priced plan with status='active'.
--
-- THE FIX
-- Take away the grant. Verified beforehand: the frontend (artifacts/bookza) has
-- ZERO writes to this table. Every legitimate write comes from api-server (4
-- files, via getSupabaseAdmin() -> service_role) or the subscription-management
-- and payfast-webhook edge functions. service_role bypasses RLS and grants, so
-- none of them are affected.
--
-- SELECT is retained for `authenticated` because the billing page reads it, and
-- subscriptions_select_own still scopes that to the caller's own rows.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscriptions FROM authenticated;

-- anon has no legitimate interaction with subscriptions at all.
REVOKE ALL ON public.subscriptions FROM anon;

-- The subscriptions_insert_own / _update_own / _delete_own policies are left in
-- place deliberately: they are now unreachable via the REST API, but remain
-- correct as defence-in-depth if a grant is ever restored.

-- ---------------------------------------------------------------------------
-- KNOWN ISSUE, NOT FIXED HERE - usage_tracking quota evasion
--
-- usage_tracking has the same row-level-vs-column-level weakness, and
-- `usage_tracking_all_own` grants the owner full write access. A user can reset
-- their own usage counters and evade plan limits.
--
-- It is NOT revoked here because the frontend currently performs the increment
-- itself (artifacts/bookza/src/pages/marketing.tsx:984 UPDATE, :994 INSERT), so
-- revoking the grant would break marketing sends.
--
-- Proper fix is an application change: move the increment into the api-server or
-- an edge function running as service_role, then revoke INSERT/UPDATE/DELETE on
-- usage_tracking from authenticated. A client that is trusted to report its own
-- quota consumption cannot enforce a quota.
-- ---------------------------------------------------------------------------
