-- =============================================================================
-- Migration 233: Engineering PM + Assets V2 equipment identity (Phase 3)
-- =============================================================================
-- Additive only. Nothing historical is edited, no data is removed, no existing column changes meaning.
--
--   1. assets.row_version: an optimistic-concurrency token for equipment edits. The API bumps it on every edit made
--      through PATCH /assets/{id}, and an edit that names a stale version is refused (409) instead of silently
--      overwriting a colleague's change. assets has no updated_at trigger, and the AI risk score / downtime jobs write
--      to the same row, so a timestamp would raise false conflicts; only user edits move this counter.
--   2. assets.photo_evidence_id: the ONE evidence record that is this equipment's identity photograph. Inspection
--      photos stay linked to their own PM completions; the pointer is what tells them apart, so replacing the identity
--      photo never touches inspection evidence. The file itself lives in the existing private evidence bucket and is only
--      ever served through a short-lived signed URL.
--
-- Recovery: both are new columns with safe defaults; older API builds neither read nor write them.
-- =============================================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS photo_evidence_id UUID REFERENCES public.evidence_records(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.assets.row_version IS 'Optimistic-concurrency counter; incremented only by user edits through the assets API.';
COMMENT ON COLUMN public.assets.photo_evidence_id IS 'The evidence record holding this equipment''s identity photograph (private bucket, signed URL access). NULL = no photo.';

CREATE INDEX IF NOT EXISTS idx_assets_photo_evidence ON public.assets (photo_evidence_id) WHERE photo_evidence_id IS NOT NULL;
