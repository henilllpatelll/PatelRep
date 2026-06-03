-- Create storage bucket for work order photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'work-order-photos',
  'work-order-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated staff can upload work order photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'work-order-photos');

CREATE POLICY "Public can view work order photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'work-order-photos');
