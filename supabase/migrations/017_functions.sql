-- =============================================================================
-- Migration 017: PostgreSQL Functions & Triggers
-- Utility functions for vector search, credit accounting, timestamps, and
-- automated room status transitions on inspection completion
-- =============================================================================

-- ---------------------------------------------------------------------------
-- match_sop_chunks
-- Semantic similarity search over SOP document chunks using pgvector cosine
-- distance. Called by the SOP Query Edge Function for RAG retrieval.
--
-- Parameters:
--   query_embedding  - 1536-dim vector from OpenAI text-embedding-3-small
--   match_hotel_id   - tenant UUID for row-level filtering
--   match_threshold  - minimum similarity score to include (default 0.75)
--   match_count      - maximum number of chunks to return (default 5)
-- ---------------------------------------------------------------------------
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
  'Cosine similarity search over SOP chunks for RAG. Returns chunks above match_threshold ordered by relevance.';

-- ---------------------------------------------------------------------------
-- increment_credits_used
-- Atomically increments credits_used in the current billing period's ledger
-- row. Called by every AI Edge Function after a successful AI interaction.
-- Uses decimal input to support fractional credit costs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_credits_used(
  p_hotel_id uuid,
  p_credits  decimal
)
RETURNS void
LANGUAGE sql AS $$
  UPDATE credit_ledger
  SET credits_used = credits_used + p_credits::int
  WHERE
    tenant_id    = p_hotel_id
    AND period_start <= CURRENT_DATE
    AND period_end   >= CURRENT_DATE
    AND is_finalized = FALSE;
$$;

COMMENT ON FUNCTION increment_credits_used IS
  'Atomically adds credits to the active billing period ledger. Call after every successful AI interaction.';

-- ---------------------------------------------------------------------------
-- update_updated_at_column
-- Generic BEFORE UPDATE trigger function that sets updated_at = NOW().
-- Applied to all tables that have an updated_at column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column IS
  'Generic trigger function to auto-update updated_at on row modification.';

-- Apply updated_at trigger to all relevant tables --

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sop_documents_updated_at
  BEFORE UPDATE ON sop_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_opera_credentials_updated_at
  BEFORE UPDATE ON opera_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- handle_inspection_complete
-- AFTER INSERT trigger on inspections that automatically transitions
-- room_status based on the inspection outcome:
--   passed      → INSPECTED (room ready for guest check-in)
--   failed      → DIRTY     (return to cleaning queue)
--   conditional → INSPECTED (accepted with minor notes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_inspection_complete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.overall_result IN ('passed', 'conditional') THEN
    UPDATE room_status
    SET
      status             = 'INSPECTED',
      last_inspected_at  = NOW(),
      last_inspected_by  = NEW.inspected_by,
      updated_at         = NOW()
    WHERE room_id = NEW.room_id;

  ELSIF NEW.overall_result = 'failed' THEN
    UPDATE room_status
    SET
      status     = 'DIRTY',
      updated_at = NOW()
    WHERE room_id = NEW.room_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_inspection_complete IS
  'Trigger function: updates room_status to INSPECTED (pass/conditional) or DIRTY (fail) after inspection INSERT.';

CREATE TRIGGER on_inspection_complete
  AFTER INSERT ON inspections
  FOR EACH ROW EXECUTE FUNCTION handle_inspection_complete();

-- ---------------------------------------------------------------------------
-- handle_room_status_history
-- AFTER UPDATE trigger on room_status that automatically appends a row to
-- room_status_history whenever the status column changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_room_status_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log when status actually changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO room_status_history (
      room_id,
      tenant_id,
      from_status,
      to_status,
      changed_by,
      change_source
    ) VALUES (
      NEW.room_id,
      NEW.tenant_id,
      OLD.status,
      NEW.status,
      NEW.assigned_to,     -- best available proxy; Edge Functions may override
      'app'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_room_status_history IS
  'Trigger function: auto-appends status transition records to room_status_history on room_status UPDATE.';

CREATE TRIGGER on_room_status_change
  AFTER UPDATE ON room_status
  FOR EACH ROW EXECUTE FUNCTION handle_room_status_history();
