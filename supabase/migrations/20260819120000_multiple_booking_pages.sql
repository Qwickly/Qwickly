-- Multiple booking pages per business.
--
-- booking_page_settings was keyed by business_id, so a business had exactly one
-- page and "which one is live" was not a question anyone could ask. This gives
-- each page its own id and lets a business keep several — a general page, a
-- seasonal one, one per location — with exactly one marked active.
--
-- "Active" is not the same as "published": several pages can be published (each
-- has its own public URL), while the active one is the page the app treats as
-- this business's main booking link.
--
-- Nothing references booking_page_settings by foreign key, so re-keying it is
-- safe; existing rows keep their data and become that business's active page.

BEGIN;

-- 1. Give every page its own identity.
ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- The page that existed before this migration is the business's active one.
UPDATE public.booking_page_settings SET is_active = true WHERE is_active = false;

-- 2. Re-key the table. business_id stops being unique and becomes an ordinary
--    foreign key column, which is what allows more than one row per business.
ALTER TABLE public.booking_page_settings
  DROP CONSTRAINT IF EXISTS booking_page_settings_pkey;

ALTER TABLE public.booking_page_settings
  ADD CONSTRAINT booking_page_settings_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS booking_page_settings_business_id_idx
  ON public.booking_page_settings (business_id);

-- 3. Exactly one active page per business, enforced by the database rather than
--    by whichever code path happened to write last.
CREATE UNIQUE INDEX IF NOT EXISTS booking_page_settings_one_active_per_business
  ON public.booking_page_settings (business_id)
  WHERE is_active;

-- Slugs stay globally unique: they are public URLs, and two pages cannot share
-- one whether or not they belong to the same business. (Constraint already
-- exists as booking_page_settings_slug_unique; restated here as documentation
-- of the intent, not re-created.)

COMMIT;
