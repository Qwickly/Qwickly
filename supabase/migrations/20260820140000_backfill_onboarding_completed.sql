-- Backfill `businesses.onboarding_completed` for accounts that predate the
-- onboarding flow.
--
-- The column has existed since 002_onboarding.sql but nothing ever wrote to it:
-- the seven-tab wizard it was built for was never wired to a screen, so every
-- business in production still reads `false`. That was harmless while the flag
-- only chose between two landing pages. It is not harmless now — /onboarding is
-- gated on it, so shipping the new flow without this would drop every existing
-- customer back into first-run setup.
--
-- "Already set up" is read from the account having done something real, since
-- there is no record of who saw what. Any business with a service, a booking, a
-- staff member or a subscription has plainly been past setup.

UPDATE public.businesses AS b
SET onboarding_completed = true
WHERE b.onboarding_completed = false
  AND (
    EXISTS (SELECT 1 FROM public.services       s WHERE s.business_id = b.id)
    OR EXISTS (SELECT 1 FROM public.bookings      k WHERE k.business_id = b.id)
    OR EXISTS (SELECT 1 FROM public.staff_members m WHERE m.business_id = b.id)
    OR EXISTS (SELECT 1 FROM public.subscriptions u WHERE u.business_id = b.id)
  );

-- A business with none of the above has never used the product, so sending it
-- through the new flow is the right outcome — it is left as `false` on purpose.
