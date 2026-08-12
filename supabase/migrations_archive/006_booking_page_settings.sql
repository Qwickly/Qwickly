-- Public booking page customization per business

CREATE TABLE IF NOT EXISTS public.booking_page_settings (
  business_id          UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  page_title           TEXT NOT NULL DEFAULT '',
  description          TEXT NOT NULL DEFAULT '',
  welcome_message      TEXT NOT NULL DEFAULT '',
  slug                 TEXT NOT NULL,
  require_deposit      BOOLEAN NOT NULL DEFAULT false,
  allow_rescheduling   BOOLEAN NOT NULL DEFAULT true,
  show_staff_selection BOOLEAN NOT NULL DEFAULT true,
  show_prices          BOOLEAN NOT NULL DEFAULT true,
  show_duration        BOOLEAN NOT NULL DEFAULT true,
  cover_image_url      TEXT,
  logo_url             TEXT,
  primary_color        TEXT NOT NULL DEFAULT '#10b981',
  secondary_color      TEXT NOT NULL DEFAULT '#059669',
  layout               TEXT NOT NULL DEFAULT 'classic' CHECK (layout IN ('classic', 'minimal', 'cards', 'split')),
  font_family          TEXT NOT NULL DEFAULT 'inter' CHECK (font_family IN ('inter', 'serif', 'rounded', 'mono')),
  border_radius        TEXT NOT NULL DEFAULT 'md' CHECK (border_radius IN ('none', 'sm', 'md', 'lg', 'full')),
  header_style         TEXT NOT NULL DEFAULT 'banner' CHECK (header_style IN ('banner', 'compact', 'centered')),
  button_style         TEXT NOT NULL DEFAULT 'filled' CHECK (button_style IN ('filled', 'outline', 'soft')),
  background_style     TEXT NOT NULL DEFAULT 'gradient' CHECK (background_style IN ('solid', 'gradient', 'image')),
  is_published         BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_page_settings_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS booking_page_settings_slug_idx ON public.booking_page_settings(slug);

DROP TRIGGER IF EXISTS booking_page_settings_updated_at ON public.booking_page_settings;
CREATE TRIGGER booking_page_settings_updated_at
  BEFORE UPDATE ON public.booking_page_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.booking_page_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_page_owner" ON public.booking_page_settings;
CREATE POLICY "booking_page_owner" ON public.booking_page_settings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "booking_page_public_read" ON public.booking_page_settings;
CREATE POLICY "booking_page_public_read" ON public.booking_page_settings
  FOR SELECT TO anon, authenticated
  USING (is_published = true);

DROP POLICY IF EXISTS "services_public_read" ON public.services;
CREATE POLICY "services_public_read" ON public.services
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.booking_page_settings bps
      WHERE bps.business_id = services.business_id AND bps.is_published = true
    )
  );

DROP POLICY IF EXISTS "staff_public_read" ON public.staff_members;
CREATE POLICY "staff_public_read" ON public.staff_members
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.booking_page_settings bps
      WHERE bps.business_id = staff_members.business_id AND bps.is_published = true
    )
  );
