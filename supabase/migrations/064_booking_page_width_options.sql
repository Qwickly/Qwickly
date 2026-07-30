ALTER TABLE public.booking_page_settings
  DROP CONSTRAINT IF EXISTS booking_page_settings_page_width_check;

UPDATE public.booking_page_settings
SET page_width = 'auto'
WHERE page_width IS NULL OR page_width IN ('comfortable', 'wide');

ALTER TABLE public.booking_page_settings
  ALTER COLUMN page_width SET DEFAULT 'auto';

ALTER TABLE public.booking_page_settings
  ADD CONSTRAINT booking_page_settings_page_width_check
  CHECK (page_width IN ('auto', 'compact'));
