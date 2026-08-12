# Qwickly — RLS / authorization review

Collected 2026-08-12 against the live database. This is a **separate review from
`FINDINGS.md`**, which was a dead-object audit and deliberately did not examine
authorization. This one reads the contents of all 87 RLS policies, the grants
behind them, and the 216 Postgres functions.

**Key premise: the Supabase `anon` key is public.** It ships in your frontend
bundle. "What `anon` can do" means "what anyone on the internet can do."

Note on roles: a policy with `roles={public}` applies to **every** role including
`anon`. Only `{authenticated}` excludes anonymous callers. Most policies here are
`{public}` and rely on `auth.uid()` returning NULL for anon — which works, but
means the `true`-valued policies below are wide open.

> **Provenance.** This review was produced on 2026-08-12 by introspecting the
> live database (`kzfixfcatknkkqttnvvi`), but from a **stale replica checkout**
> (`dylanhunterolsen/qwickly`) rather than this repo. Every finding below was
> derived from the database itself, so the fixes are correct and have been
> re-verified against this repo's code.
>
> Two claims in the original write-up were artifacts of that stale checkout and
> have been removed: `contact_submissions` and `payment_provider_credentials`
> were described as existing with no migration. They are `060_contact_submissions.sql`
> and `068_payment_provider_credentials.sql` here. There was no schema drift.
>
> The companion `FINDINGS.md` (a dead-table/column audit) was deliberately **not**
> carried over — its central conclusion depended on that stale migration set.

## Status

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | anon INSERT/UPDATE on 4 tables (`true`/`true` policies) | HIGH | **FIXED** — `059` |
| 2 | `compute_available_slots` wrapper bypass | MEDIUM | **FIXED** — `059` |
| 3 | `seed_*` functions, no auth check | MEDIUM | **FIXED** — `059` |
| 4 | Subscription self-upgrade (paid-tier bypass) | **HIGH** | **FIXED** — `060` |
| 5 | `usage_tracking` quota evasion | HIGH | **OPEN** — needs app change |
| 6 | Blanket anon write grants on all 55 tables | HIGH | OPEN |
| 7 | `has_active_subscription` anon-callable | LOW | OPEN |

Fixes were applied as numbered migrations (`supabase/migrations/059_rls_hardening.sql`,
`060_subscription_privilege_escalation.sql`) rather than hand-applied SQL, and each
was verified live by impersonating `anon` / `authenticated` via `SET ROLE` inside a
rolled-back transaction.

Post-fix regression checks, all passing: the public booking flow still returns slots
as `anon` (33/day on open days for `glow-studio-demo`); the billing page still reads
its own subscription as `authenticated`; `service_role` still writes normally.

## HIGH (FIXED) — subscription self-upgrade, a confirmed paid-tier bypass

`subscriptions_update_own` authorises on row ownership only:

```sql
USING ((user_id = auth.uid()) OR user_owns_business(business_id))
```

RLS is **row-level, not column-level**. That predicate can express "this row is
yours"; it cannot express "you may not change `plan_id`". Adding a `WITH CHECK`
would not have helped — the new row still belongs to the same user.

Combined with the blanket UPDATE grant held by `authenticated`, any logged-in
user could `PATCH /rest/v1/subscriptions?id=eq.<their-own-sub>` with
`{"plan_id": "<most expensive plan>", "status": "active"}` and upgrade themselves
for free. **Verified live** (rolled back): the update succeeded.

Fixed in `060` by revoking INSERT/UPDATE/DELETE from `authenticated` and all
privileges from `anon`. Verified safe first: the frontend has zero writes to this
table — every legitimate write is api-server or edge-function code running as
`service_role`, which bypasses grants and RLS.

**This is the general lesson for this schema:** any table where a user owns rows
that contain privileged fields has this shape. Ownership-based RLS is not
sufficient for billing, quota, or status columns; those need the grant removed
and writes routed through `service_role`.

## HIGH (OPEN) — `usage_tracking` quota evasion

Same root cause, not yet fixable with SQL alone. `usage_tracking_all_own` gives
owners full write access, so a user can reset their own counters and evade plan
limits.

The grant cannot simply be revoked because **the frontend performs the increment
itself** — `artifacts/bookza/src/pages/marketing.tsx:984` (UPDATE) and `:994`
(INSERT). Revoking would break marketing sends.

Fix requires an application change: move the increment into api-server or an edge
function running as `service_role`, then revoke INSERT/UPDATE/DELETE from
`authenticated`. A client trusted to report its own quota consumption cannot
enforce a quota.

## HIGH (FIXED) — anon can insert and modify rows in 4 tables

Four policies combine `roles={public}` with `USING (true)` / `WITH CHECK (true)`:

| Table | Policy | Command |
|---|---|---|
| `recipient_insights` | `recipient_insights_system_insert` / `_system_update` | INSERT, UPDATE |
| `number_warmup` | `number_warmup_system_insert` / `_system_update` | INSERT, UPDATE |
| `warmup_config` | `warmup_config_system_update` | UPDATE |
| `ab_test_assignments` | `ab_test_assignments_system_insert` / `_system_update` | INSERT, UPDATE |

`anon` also holds the matching INSERT/UPDATE grants, so these are reachable now
via the REST API — a `PATCH /rest/v1/recipient_insights?id=eq.<id>` with the
public anon key will succeed.

The `_system_` naming shows the intent: these were meant for the service role,
which is what the api-server and edge functions use. But the service role
**bypasses RLS entirely** — it never needed a policy. Writing `true` and leaving
the role as `{public}` granted the access to the whole internet instead.

Reading is still blocked (`_select_own` correctly uses `user_owns_business`), so
this is not a data-theft path. The exposure is unauthenticated **writes**:
corrupting engagement data, or tampering with `warmup_config` / `number_warmup`,
which govern WhatsApp send pacing — manipulating those could plausibly get a
tenant's WhatsApp number rate-limited or banned.

**Fix:** drop the four `_system_` policies outright. The service role does not
need them.

## HIGH (systemic) — anon holds write grants on all 55 tables

Every table in `public` grants `anon` INSERT, UPDATE, and DELETE (plus SELECT,
TRUNCATE, REFERENCES, TRIGGER). RLS is therefore the **only** thing preventing
anonymous writes anywhere in the database.

This is why the four policies above are exploitable rather than merely untidy,
and it means **any future table added without a policy is immediately world
-writable**. `contact_submissions` and `payment_provider_credentials` are safe
only because they happen to carry zero policies — that is luck, not design.

**Fixed in `074_restrict_anon_grants.sql`:** all table privileges revoked from
`anon`, then `SELECT` granted back on the four tables the public booking page
reads. Public writes are unaffected — `create_public_booking` and the
manage-token functions are SECURITY DEFINER and need no table grants.
`ALTER DEFAULT PRIVILEGES` stops new tables auto-granting to `anon`.

Re-verified against this repo after the fact: the public booking page reads six
tables, but `businesses` and `deposit_settings` carry only `auth.uid()`-based
policies, so `anon` could never read them either way. Nothing that worked before
stopped working.

## MEDIUM — `compute_available_slots` bypasses its own wrapper's auth check

`get_business_booking_slots(p_business_id, ...)` correctly starts with:

```sql
IF NOT public.user_owns_business(p_business_id) THEN RETURN; END IF;
```

But it then calls `compute_available_slots(...)`, and **that inner function is
itself granted to `anon`** and performs no ownership check. Calling it directly
skips the guard entirely.

Impact: anyone can enumerate availability and staff schedules for any business by
UUID, including businesses whose booking page is unpublished. Not PII, but it
defeats the intended control.

**Fix:** `REVOKE EXECUTE ON FUNCTION public.compute_available_slots(...) FROM
anon, public;` It only needs to be callable by the two wrappers, which are
SECURITY DEFINER and run as the owner.

## MEDIUM — two seed functions accept an arbitrary business_id with no auth check

`seed_business_defaults(p_business_id, p_owner_name, p_owner_email)` and
`seed_bot_defaults(p_business_id)` are SECURITY DEFINER, callable by `anon`, and
neither verifies the caller owns the business.

Every insert uses `ON CONFLICT DO NOTHING` with inert defaults (`is_open=false`,
`enabled=false`), so an attacker cannot overwrite configured data. But they can
pre-create rows for any not-yet-configured business — including seeding
`whatsapp_bot_working_hours`, which would make a tenant's bot answer on hours they
never set.

**Fix:** add `IF NOT public.user_owns_business(p_business_id) THEN RAISE
EXCEPTION ...` at the top of both, or revoke EXECUTE from anon (they appear to be
called from `ensure_my_business`, which already derives the business from
`auth.uid()`).

## LOW — `has_active_subscription(business_uuid)` is anon-callable

Leaks whether any given business has an active subscription. Minor, but it is
billing state exposed to unauthenticated callers.

## What is correctly built

Worth stating plainly, because most of this schema is solid:

- `user_owns_business` and `user_owns_tenant` are correct SECURITY DEFINER
  helpers keyed on `auth.uid()`, and tenant isolation across the ~45 business
  -owned tables is applied consistently through them.
- The public booking surface is properly gated: `services_public_read`,
  `staff_public_read`, and `booking_page_public_read` all require
  `is_published = true`, and the service/staff policies additionally join back to
  `booking_page_settings` to confirm publication.
- `get_business_booking_slots` does check ownership.
- `whatsapp_session_data` carries an explicit `Deny anon access` policy.
- **No table has RLS disabled.** Every one of the 55 has it enabled.
- No policy grants cross-tenant SELECT. There is no "read all businesses" hole.

The failure mode here is narrow and consistent: `_system_` policies written for a
role that never needed them, plus over-broad default grants. It is not a
pervasively insecure schema.

## Recommended order

1. Drop the four `_system_` policies (highest impact, zero risk to app behaviour —
   the service role ignores RLS).
2. Revoke EXECUTE on `compute_available_slots` from anon/public.
3. Add ownership checks to `seed_business_defaults` / `seed_bot_defaults`.
4. Revoke blanket write grants from `anon`, then re-test the public booking flow.
5. Rotate the committed `SUPABASE_SERVICE_ROLE_KEY` (see `RESUME.md`) — that key
   bypasses every policy discussed here, so it outranks all of the above.

## Not yet reviewed

This pass covered RLS policies, table grants, and function exposure. Still
unexamined: the body of `create_public_booking` (input validation, slot
double-booking, price/deposit tampering), the three `*_by_manage_token` functions
(token entropy and what they return), storage bucket policies for
`booking-page-assets`, and the edge functions' own authorization — notably
`payfast-webhook`, where signature verification is the control that matters.
