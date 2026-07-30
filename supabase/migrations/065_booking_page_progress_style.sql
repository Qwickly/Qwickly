-- Adds booking page progress indicator style selection.

ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS progress_style TEXT NOT NULL DEFAULT 'line';

ALTER TABLE public.booking_page_settings
  DROP CONSTRAINT IF EXISTS booking_page_settings_progress_style_check;

ALTER TABLE public.booking_page_settings
  ADD CONSTRAINT booking_page_settings_progress_style_check
  CHECK (progress_style IN ('line', 'tiles', 'minimal'));
