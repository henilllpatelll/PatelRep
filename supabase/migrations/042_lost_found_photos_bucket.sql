-- Create storage bucket for lost and found item photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lost-found-photos',
  'lost-found-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated staff can upload lost-found photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lost-found-photos');

CREATE POLICY "Public can view lost-found photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'lost-found-photos');
