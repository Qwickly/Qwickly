-- Adds public booking page display controls used by the booking page builder.

ALTER TABLE public.booking_page_settings
  ADD COLUMN IF NOT EXISTS theme_mode TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS page_width TEXT NOT NULL DEFAULT 'comfortable',
  ADD COLUMN IF NOT EXISTS show_notes BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_page_settings_theme_mode_check'
  ) THEN
    ALTER TABLE public.booking_page_settings
      ADD CONSTRAINT booking_page_settings_theme_mode_check
      CHECK (theme_mode IN ('auto', 'light', 'dark'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_page_settings_page_width_check'
  ) THEN
    ALTER TABLE public.booking_page_settings
      ADD CONSTRAINT booking_page_settings_page_width_check
      CHECK (page_width IN ('compact', 'comfortable', 'wide'));
  END IF;
END $$;
