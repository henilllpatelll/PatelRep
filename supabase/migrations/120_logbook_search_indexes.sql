-- =============================================================================
-- Migration 120: Logbook historical search indexes (Phase 6)
-- The API always scopes logbook discovery by tenant, then filters by an
-- operational date range. Trigram content search keeps partial phrase lookup
-- responsive without adding an external search service.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_logbook_entries_tenant_entry_date
  ON public.logbook_entries (tenant_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_logbook_entries_content_trgm
  ON public.logbook_entries USING GIN (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_logbook_entries_tenant_author_date
  ON public.logbook_entries (tenant_id, author_id, entry_date DESC)
  WHERE author_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logbook_entries_tenant_related_date
  ON public.logbook_entries (tenant_id, related_type, related_id, entry_date DESC)
  WHERE related_id IS NOT NULL;

COMMENT ON INDEX idx_logbook_entries_content_trgm IS
  'Supports tenant-scoped case-insensitive partial Logbook content search.';
