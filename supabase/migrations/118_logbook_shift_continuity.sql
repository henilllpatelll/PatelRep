-- =============================================================================
-- Migration 118: Logbook shift continuity (Phase 4)
-- Adds carry-forward chain fields, a resolution note, and a lightweight
-- operational-history event log backing the Entry Detail drawer's History tab.
-- =============================================================================

ALTER TABLE public.logbook_entries
  ADD COLUMN carried_from_entry_id UUID NULL REFERENCES public.logbook_entries(id) ON DELETE SET NULL,
  ADD COLUMN carried_forward_at TIMESTAMPTZ NULL,
  ADD COLUMN carried_forward_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN resolution_note TEXT NULL;

-- A source entry may only ever produce one successor — this is the server-side
-- guard against duplicate/repeated Carry Forward (spec: "Prevent Duplicate
-- Carry-Forward" + "Prevent Re-Carrying Old Source Once Successor Exists").
CREATE UNIQUE INDEX idx_logbook_entries_carried_from_unique
  ON public.logbook_entries (carried_from_entry_id)
  WHERE carried_from_entry_id IS NOT NULL;

CREATE INDEX idx_logbook_entries_tenant_carried_from
  ON public.logbook_entries (tenant_id, carried_from_entry_id)
  WHERE carried_from_entry_id IS NOT NULL;

COMMENT ON COLUMN public.logbook_entries.carried_from_entry_id IS 'Self-reference forming the shift-continuity chain. ON DELETE SET NULL so deleting one link in the chain never cascades the rest of the chain away.';
COMMENT ON COLUMN public.logbook_entries.resolution_note IS 'Free-text note captured when an entry is marked resolved; kept separate from content so the original handoff text is never overwritten.';

-- ---------------------------------------------------------------------------
-- logbook_entry_events — append-only operational history for the Entry Detail
-- drawer's History tab. Deliberately narrow: no comment/read/ack events yet —
-- those belong to a later phase's dedicated collaboration system.
-- ---------------------------------------------------------------------------
CREATE TABLE public.logbook_entry_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id    UUID        NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL CHECK (event_type IN ('created', 'edited', 'carried_forward', 'resolved', 'archived', 'reopened')),
  actor_id    UUID        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_logbook_entry_events_entry_created
  ON public.logbook_entry_events (entry_id, created_at);
CREATE INDEX idx_logbook_entry_events_tenant
  ON public.logbook_entry_events (tenant_id);

ALTER TABLE public.logbook_entry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.logbook_entry_events
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

COMMENT ON TABLE public.logbook_entry_events IS 'Append-only operational history for Logbook entries (Phase 4 Entry Detail drawer History tab). Existing pre-Phase-4 entries have no created event on purpose — the UI falls back to created_at/author for those instead of a backfill.';
