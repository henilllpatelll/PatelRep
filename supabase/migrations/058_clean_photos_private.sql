-- Make clean-photos bucket private; access only via signed URLs
UPDATE storage.buckets SET public = false WHERE id = 'clean-photos';

DROP POLICY IF EXISTS "Public can view clean photos" ON storage.objects;

CREATE POLICY "Authenticated staff can view clean photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'clean-photos');
