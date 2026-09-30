-- Phase 8: retention metadata and cached, tenant-scoped user-content translation.

ALTER TABLE public.logbook_entries
  ADD COLUMN IF NOT EXISTS archive_reason TEXT NULL CHECK (archive_reason IN ('manual', 'expired')),
  ADD COLUMN IF NOT EXISTS archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_logbook_entries_expiry_cleanup
  ON public.logbook_entries (expires_at)
  WHERE expires_at IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.logbook_content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('entry_content', 'entry_resolution_note', 'comment')),
  source_id UUID NOT NULL,
  source_hash TEXT NOT NULL,
  source_language TEXT NULL CHECK (source_language IN ('en', 'es')),
  target_language TEXT NOT NULL CHECK (target_language IN ('en', 'es')),
  translated_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_type, source_id, source_hash, target_language)
);

CREATE INDEX IF NOT EXISTS idx_logbook_translation_lookup
  ON public.logbook_content_translations (tenant_id, source_type, source_id, source_hash, target_language);

ALTER TABLE public.logbook_content_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.logbook_content_translations
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

ALTER TABLE public.logbook_entry_events
  DROP CONSTRAINT IF EXISTS logbook_entry_events_event_type_check;
ALTER TABLE public.logbook_entry_events
  ADD CONSTRAINT logbook_entry_events_event_type_check CHECK (event_type IN (
    'created', 'edited', 'carried_forward', 'resolved', 'archived', 'reopened',
    'comment_added', 'acknowledgment_requested', 'acknowledgment_reset', 'attachment_removed'
  ));
