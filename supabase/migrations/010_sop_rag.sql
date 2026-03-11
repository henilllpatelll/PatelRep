-- =============================================================================
-- Migration 010: SOP Documents & RAG Vector Store
-- Standard Operating Procedure document storage and pgvector chunk indexing
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sop_documents
-- Uploaded SOP/policy documents (PDF, DOCX, etc.). After upload, an Edge
-- Function processes the document into chunks and generates embeddings.
-- ---------------------------------------------------------------------------
CREATE TABLE sop_documents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT,                              -- e.g. "Housekeeping", "Emergency", "HR"
  storage_path     TEXT        NOT NULL,              -- Supabase Storage object path
  file_size_bytes  INT,
  page_count       INT,
  indexing_status  TEXT        NOT NULL DEFAULT 'pending' CHECK (indexing_status IN (
                     'pending',    -- uploaded, not yet processed
                     'processing', -- chunking and embedding in progress
                     'indexed',    -- embeddings stored, available for search
                     'failed'      -- processing error, see logs
                   )),
  chunk_count      INT         DEFAULT 0,             -- number of vector chunks generated
  indexed_at       TIMESTAMPTZ,                       -- when indexing completed
  uploaded_by      UUID        NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sop_documents IS 'SOP and policy document registry. Indexed into vector chunks for AI-powered retrieval.';
COMMENT ON COLUMN sop_documents.storage_path IS 'Supabase Storage path, e.g. "sop-docs/{tenant_id}/{filename}".';
COMMENT ON COLUMN sop_documents.indexing_status IS 'Processing pipeline status: pending → processing → indexed (or failed).';
COMMENT ON COLUMN sop_documents.chunk_count IS 'Number of text chunks generated and stored in sop_chunks.';

-- ---------------------------------------------------------------------------
-- sop_chunks
-- Text chunks derived from SOP documents with pgvector embeddings.
-- Used for semantic similarity search in the AI assistant.
-- ---------------------------------------------------------------------------
CREATE TABLE sop_chunks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID        NOT NULL REFERENCES sop_documents(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_index   INT         NOT NULL,             -- zero-based position within document
  content       TEXT        NOT NULL,             -- raw text content of the chunk
  token_count   INT,                              -- approximate token count for context budgeting
  page_number   INT,                              -- source page in original document
  embedding     vector(1536),                     -- OpenAI text-embedding-3-small (1536 dims)
  metadata      JSONB       DEFAULT '{}',         -- arbitrary metadata (section headers, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sop_chunks IS 'Vector-embedded text chunks from SOP documents. Used for RAG similarity search.';
COMMENT ON COLUMN sop_chunks.embedding IS 'OpenAI text-embedding-3-small 1536-dimensional vector. NULL until embedding job completes.';
COMMENT ON COLUMN sop_chunks.chunk_index IS 'Zero-based chunk position within the parent document for ordered reconstruction.';
COMMENT ON COLUMN sop_chunks.metadata IS 'Optional metadata: section titles, heading hierarchy, source page range, etc.';

-- ---------------------------------------------------------------------------
-- IVFFlat index for approximate nearest-neighbor cosine similarity search.
-- lists = 100 is appropriate for datasets up to ~1M vectors.
-- Rebuild with higher lists count as corpus grows beyond 500K chunks.
-- ---------------------------------------------------------------------------
CREATE INDEX sop_chunks_embedding_idx
  ON sop_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON INDEX sop_chunks_embedding_idx IS 'IVFFlat ANN index for cosine similarity search. Rebuild if chunk count exceeds 1M.';
