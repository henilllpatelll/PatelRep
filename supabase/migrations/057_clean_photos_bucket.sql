-- Migration 057: Storage bucket for room clean photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clean-photos',
  'clean-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated staff can upload clean photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'clean-photos');

CREATE POLICY "Public can view clean photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'clean-photos');
