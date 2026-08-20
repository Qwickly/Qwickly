-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: a just-expired trial got no grace week at all.
--
-- business_booking_access decided grace from an explicit status list —
-- 'trial_expired', 'canceled', 'past_due' — which was right in spirit and wrong
-- in practice. The status of an expired trial is not 'trial_expired' until the
-- hourly sweep in subscription-charger.ts restatuses it. In the gap between the
-- trial actually running out and that sweep running, the row is still
-- 'trialing' with a past current_period_end, matched no branch, and fell
-- through to 'closed'.
--
-- So the booking page went dark the moment the trial ended and only came back
-- up to an hour later, when the sweep happened to run — the grace week
-- starting, at best, late and at worst not at all if the worker was down. The
-- entitlements resolver already refuses to depend on that sweep for exactly
-- this reason; this function should not have either.
--
-- The rule is now: a trialing row past its end is treated as the expired trial
-- it is, whatever the stored status says. The sweep stays what it always was —
-- bookkeeping, not the source of truth.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."business_booking_access"("p_business_id" "uuid")
RETURNS "text"
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        -- Live and paid.
        WHEN s.status = 'active' THEN 'open'

        -- A trial with time left on it.
        WHEN s.status = 'trialing' AND s.current_period_end > now() THEN 'open'

        -- A trial that has run out. Deliberately keyed on the DATE, not on the
        -- status having been swept to 'trial_expired' yet: those are the same
        -- fact, and only one of them is true the instant the trial ends.
        WHEN s.status = 'trialing'
             AND s.current_period_end > now() - INTERVAL '7 days' THEN 'grace'

        -- Lapsed for a known reason, within the last week.
        WHEN s.status IN ('trial_expired', 'canceled', 'past_due')
             AND s.current_period_end > now() - INTERVAL '7 days' THEN 'grace'

        -- Everything else, explicitly including 'incomplete': that is a checkout
        -- somebody started and abandoned, and checkout writes
        -- current_period_end a month into the future before any money changes
        -- hands. Reading that future date as a recent lapse would hand a month
        -- of free booking page to someone who never paid.
        ELSE 'closed'
      END
      FROM public.subscriptions s
      WHERE s.business_id = p_business_id
      ORDER BY
        CASE s.status
          WHEN 'active' THEN 0
          WHEN 'trialing' THEN 1
          WHEN 'past_due' THEN 2
          ELSE 3
        END,
        s.created_at DESC
      LIMIT 1
    ),
    'closed'
  );
$$;

ALTER FUNCTION "public"."business_booking_access"("p_business_id" "uuid") OWNER TO "postgres";

-- CREATE OR REPLACE resets nothing about grants, but restate the intent: this
-- must not be callable by anon. business_id is public (booking_page_settings is
-- anon-readable and carries it), so a direct EXECUTE grant would let anybody ask
-- whether a named business's subscription has lapsed.
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."business_booking_access"("p_business_id" "uuid") TO "service_role";
