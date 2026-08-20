-- ─────────────────────────────────────────────────────────────────────────────
-- Card-free free trial
--
-- Until now a trial was started by sending the customer to PayFast for a
-- zero-amount subscription tokenisation: it captured a card without charging,
-- and PayFast's own day-14 recurring charge is what ended the trial and flipped
-- the subscription to 'active'.
--
-- The trial no longer takes a card, which means PayFast is no longer involved in
-- starting or ending it. Three consequences, all handled here:
--
--   1. A trial can now END without converting, which is not a state the status
--      vocabulary could express. 'canceled' would be wrong — it reads as "you
--      quit" when the truth is "your trial ran out", and those two need very
--      different messaging to the customer.
--   2. Nothing external ends the trial any more, so expiry is enforced by our
--      own code (entitlements read path + the hourly lifecycle sweep). Both want
--      to find expiring trials cheaply.
--   3. Without a card at the door, a subscription row is worth far more to an
--      attacker — and RLS was letting the browser write its own.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. 'trial_expired' status ───────────────────────────────────────────────
-- Purely additive, so every existing row still satisfies the constraint.
-- Deliberately NOT part of any ("active","trialing") filter elsewhere in the
-- codebase: an expired trial should fall out of those queries on its own.
ALTER TABLE "public"."subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_status_check";

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_status_check" CHECK (
    "status" = ANY (ARRAY[
      'active'::"text",
      'past_due'::"text",
      'canceled'::"text",
      'incomplete'::"text",
      'trialing'::"text",
      'trial_expired'::"text"
    ])
  );

COMMENT ON CONSTRAINT "subscriptions_status_check" ON "public"."subscriptions" IS
  'trial_expired = a card-free trial reached its end without converting. Distinct from canceled (customer quit) because the two need different reactivation messaging.';

-- ── 2. Cheap lookup for the expiry sweep ────────────────────────────────────
-- The hourly lifecycle worker asks "which trials have run out?" every tick.
-- Partial on status so the index stays tiny — expired trials leave it as soon
-- as the sweep flips them.
CREATE INDEX IF NOT EXISTS "subscriptions_trialing_period_end_idx"
  ON "public"."subscriptions" USING "btree" ("current_period_end")
  WHERE ("status" = 'trialing'::"text");

-- ── 3. Close the self-granted-subscription hole ─────────────────────────────
-- These policies let any signed-in owner INSERT or UPDATE their own
-- subscriptions row straight from the browser — i.e. write
-- status='trialing' with current_period_end in 2099 and hand themselves the
-- product for free. That was survivable while PayFast had to see a card before
-- a trial existed; it is not survivable now that a trial is free to start.
--
-- Safe to revoke: nothing in the frontend touches this table directly. Every
-- subscription read and write goes through the subscription-management edge
-- function or the payfast-webhook, both of which use the service-role key and
-- bypass RLS entirely. SELECT stays so the client can still read its own row.
DROP POLICY IF EXISTS "subscriptions_insert_own" ON "public"."subscriptions";
DROP POLICY IF EXISTS "subscriptions_update_own" ON "public"."subscriptions";
DROP POLICY IF EXISTS "subscriptions_delete_own" ON "public"."subscriptions";

-- ── 4. One trial per person, not per business ───────────────────────────────
-- businesses.trial_used_at already stops a business trialling twice. It does
-- nothing about the same human creating a second business, which with no card
-- required is a thirty-second loop. Stamping the auth user closes that without
-- adding any friction to a genuine first signup.
CREATE TABLE IF NOT EXISTS "public"."trial_grants" (
  "user_id" "uuid" PRIMARY KEY REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "business_id" "uuid" REFERENCES "public"."businesses"("id") ON DELETE SET NULL,
  "granted_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  "expires_at" timestamp with time zone NOT NULL
);

COMMENT ON TABLE "public"."trial_grants" IS
  'One row per auth user that has ever started a free trial. The user-level half of trial eligibility; businesses.trial_used_at is the business-level half. Both are checked before a trial is granted.';

ALTER TABLE "public"."trial_grants" ENABLE ROW LEVEL SECURITY;

-- Read-only to the client, and only its own row. Writes are service-role only:
-- a user who can INSERT here can decide their own trial eligibility.
DROP POLICY IF EXISTS "trial_grants_select_own" ON "public"."trial_grants";
CREATE POLICY "trial_grants_select_own" ON "public"."trial_grants"
  FOR SELECT USING ("user_id" = "auth"."uid"());

-- ── 5. Backfill ─────────────────────────────────────────────────────────────
-- Existing card-required trials count as used. Without this, everyone who
-- already trialled under the old flow would be eligible for a second, card-free
-- one the moment this ships.
INSERT INTO "public"."trial_grants" ("user_id", "business_id", "granted_at", "expires_at")
SELECT DISTINCT ON (b."user_id")
  b."user_id",
  b."id",
  b."trial_used_at",
  b."trial_used_at" + INTERVAL '14 days'
FROM "public"."businesses" b
WHERE b."trial_used_at" IS NOT NULL
  AND b."user_id" IS NOT NULL
ORDER BY b."user_id", b."trial_used_at" ASC
ON CONFLICT ("user_id") DO NOTHING;

-- ── 6. Trial reminder send log ──────────────────────────────────────────────
-- With a card on file, day 14 converted itself and a missed reminder cost
-- nothing. Card-free, a trial that ends in silence is simply a lost customer,
-- so the reminders are now part of the revenue path rather than a courtesy.
--
-- That makes double-sending a real risk worth designing against: two worker
-- ticks overlapping would mail the same person twice. The composite primary key
-- turns "have we sent this yet?" into an insert that either succeeds or
-- violates — the worker claims a row BEFORE sending, so the loser of a race
-- sends nothing rather than both racers deciding they are first.
CREATE TABLE IF NOT EXISTS "public"."trial_reminder_log" (
  "subscription_id" "uuid" NOT NULL REFERENCES "public"."subscriptions"("id") ON DELETE CASCADE,
  "kind" "text" NOT NULL,
  "sent_at" timestamp with time zone NOT NULL DEFAULT "now"(),
  PRIMARY KEY ("subscription_id", "kind")
);

COMMENT ON TABLE "public"."trial_reminder_log" IS
  'One row per trial reminder actually sent. Claimed before the send, deleted if the send fails, so a reminder is retried but never duplicated.';

-- Service-role only: RLS on with no policies at all. Nothing in the browser has
-- any business reading or writing the send log.
ALTER TABLE "public"."trial_reminder_log" ENABLE ROW LEVEL SECURITY;
