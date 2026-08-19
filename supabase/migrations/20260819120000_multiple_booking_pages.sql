-- Several booking pages per business, but only one of them online.
--
-- booking_page_settings was keyed by business_id, so a business had exactly one
-- page. That made "draft a new page before switching to it" impossible: the only
-- page you had was the one clients were looking at.
--
-- This gives each page its own id so a business can keep several — a seasonal
-- one, a rewrite in progress, a copy to experiment on — while a partial unique
-- index keeps at most one of them published. Publishing a second page is not a
-- silent takeover: the current one has to come down first.
--
-- Nothing references booking_page_settings by foreign key, so re-keying it is
-- safe; existing rows keep their data and their published state.

BEGIN;

-- 1. Give every page its own identity.
ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- 2. Re-key the table. business_id stops being unique and becomes an ordinary
--    foreign key column, which is what allows more than one row per business.
ALTER TABLE public.booking_page_settings
  DROP CONSTRAINT IF EXISTS booking_page_settings_pkey;

ALTER TABLE public.booking_page_settings
  ADD CONSTRAINT booking_page_settings_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS booking_page_settings_business_id_idx
  ON public.booking_page_settings (business_id);

-- 3. At most one published page per business, enforced by the database rather
--    than by whichever code path happened to write last. Unpublished drafts are
--    unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS booking_page_settings_one_published_per_business
  ON public.booking_page_settings (business_id)
  WHERE is_published;

-- 4. An earlier revision of this migration carried an is_active flag, back when
--    several pages could be online at once and one of them had to be named as
--    the main link. With only one page online there is nothing to disambiguate,
--    so it goes. Dropped conditionally: most databases never saw it.
DROP INDEX IF EXISTS public.booking_page_settings_one_active_per_business;

ALTER TABLE public.booking_page_settings
  DROP COLUMN IF EXISTS is_active;

-- Slugs stay globally unique: they are public URLs, and two pages cannot share
-- one whether or not they belong to the same business. (Already enforced by
-- booking_page_settings_slug_unique; noted here as intent, not re-created.)

COMMIT;
