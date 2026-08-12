-- Storage bucket for booking page cover images and logos

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'booking-page-assets',
  'booking-page-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "booking_assets_public_read" ON storage.objects;
CREATE POLICY "booking_assets_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'booking-page-assets');

DROP POLICY IF EXISTS "booking_assets_owner_insert" ON storage.objects;
CREATE POLICY "booking_assets_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'booking-page-assets'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.businesses WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "booking_assets_owner_update" ON storage.objects;
CREATE POLICY "booking_assets_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'booking-page-assets'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.businesses WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "booking_assets_owner_delete" ON storage.objects;
CREATE POLICY "booking_assets_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'booking-page-assets'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.businesses WHERE user_id = auth.uid()
    )
  );
