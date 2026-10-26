-- =============================================================================
-- Migration 224: private storage for inspection evidence (additive only)
--
-- Phase 6 of the Supervisor Inspections redesign. Inspection photos used to be
-- written to the PUBLIC `work-order-photos` bucket and referenced by a public URL
-- (inspection_results.photo_url). Anyone holding that URL could read a photo of a
-- guest-adjacent room without signing in.
--
--   * `inspection-evidence` bucket: PRIVATE, no storage.objects policy at all. Only
--     the API (service role, which bypasses RLS) can read or write it; clients get
--     a short-lived signed URL AFTER the API has checked hotel and role.
--   * inspection_results.photo_path: the object path inside that bucket. New
--     evidence stores only this; photo_url is left NULL for it.
--
-- Evidence recorded before this migration keeps its photo_url (the object still
-- lives in the public bucket). The API never hands that raw URL to a client any
-- more - it signs the object instead - and scripts/backfill_inspection_evidence.py
-- copies those objects into the private bucket when an operator chooses to run it.
-- Nothing here rewrites, moves or deletes an existing row or object.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-evidence',
  'inspection-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.inspection_results
  ADD COLUMN IF NOT EXISTS photo_path TEXT;

COMMENT ON COLUMN public.inspection_results.photo_path IS
  'Object path inside the private inspection-evidence bucket: <hotel_id>/inspections/<inspection_id>/<template_item_id>.<ext>. NULL on historical rows, whose photo_url still points into the legacy public bucket.';
