-- Adds a configurable logo background treatment for public booking pages.

ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS logo_style TEXT NOT NULL DEFAULT 'solid';

ALTER TABLE public.booking_page_settings
  DROP CONSTRAINT IF EXISTS booking_page_settings_logo_style_check;

ALTER TABLE public.booking_page_settings
  ADD CONSTRAINT booking_page_settings_logo_style_check
  CHECK (logo_style IN ('solid', 'glass', 'dark', 'transparent'));
