-- =============================================================================
-- Migration 018: SOP Chunks Vector Search Function (authoritative definition)
-- =============================================================================
-- This migration supersedes the match_sop_chunks definition that was included
-- inline in migration 017. The function signature here uses "match_hotel_id"
-- as the tenant filter parameter, matching the 017 definition and the
-- sop_rag.py service's RPC call.
--
-- Re-creating with CREATE OR REPLACE is safe and idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION match_sop_chunks(
  query_embedding  vector(1536),
  match_hotel_id   uuid,
  match_threshold  float DEFAULT 0.75,
  match_count      int   DEFAULT 5
)
RETURNS TABLE (
  id           uuid,
  content      text,
  similarity   float,
  metadata     jsonb,
  document_id  uuid
)
LANGUAGE sql STABLE AS $$
  SELECT
    sc.id,
    sc.content,
    1 - (sc.embedding <=> query_embedding) AS similarity,
    sc.metadata,
    sc.document_id
  FROM sop_chunks sc
  WHERE
    sc.tenant_id = match_hotel_id
    AND sc.embedding IS NOT NULL
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_sop_chunks IS
  'Cosine similarity search over SOP document chunks using pgvector. Returns top-N chunks above threshold ordered by relevance. Tenant-scoped via match_hotel_id.';
