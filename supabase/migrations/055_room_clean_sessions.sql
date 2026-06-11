-- Migration 055: Room clean sessions (timer + checklist snapshot) and photos
-- Session ids are CLIENT-generated uuids so offline-created sessions replay
-- idempotently. Checklist state lives as jsonb on the session row (single
-- writer = the housekeeper; syncs as one idempotent PATCH). Photos are
-- relational because they arrive asynchronously.

CREATE TABLE IF NOT EXISTS room_clean_sessions (
  id                 uuid        PRIMARY KEY,
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id            uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  assignment_id      uuid        NULL REFERENCES room_assignments(id) ON DELETE SET NULL,
  housekeeper_id     uuid        NOT NULL,
  clean_type         text        NULL,
  previous_status    text        NULL,
  base_clean_minutes int         NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NULL,
  duration_seconds   int         NULL,
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'completed', 'abandoned')),
  blocked_reason     text        NULL
                       CHECK (blocked_reason IS NULL OR blocked_reason IN ('dnd', 'guest_in_room', 'maintenance')),
  checklist          jsonb       NOT NULL DEFAULT '[]',
  checklist_done     int         NOT NULL DEFAULT 0,
  checklist_total    int         NOT NULL DEFAULT 0,
  notes              text        NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_clean_photos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id   uuid        NOT NULL REFERENCES room_clean_sessions(id) ON DELETE CASCADE,
  room_id      uuid        NOT NULL,
  kind         text        NOT NULL DEFAULT 'proof' CHECK (kind IN ('proof', 'issue')),
  storage_path text        NOT NULL,
  url          text        NOT NULL,
  created_by   uuid        NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One active session per room (two-device conflict guard)
CREATE UNIQUE INDEX IF NOT EXISTS rcs_one_active_per_room
  ON room_clean_sessions (tenant_id, room_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS rcs_room_started_idx
  ON room_clean_sessions (tenant_id, room_id, started_at DESC);
CREATE INDEX IF NOT EXISTS rcs_housekeeper_idx
  ON room_clean_sessions (tenant_id, housekeeper_id, status);
CREATE INDEX IF NOT EXISTS rcs_assignment_idx
  ON room_clean_sessions (assignment_id);
CREATE INDEX IF NOT EXISTS rcp_session_idx
  ON room_clean_photos (session_id);
CREATE INDEX IF NOT EXISTS rcp_tenant_room_idx
  ON room_clean_photos (tenant_id, room_id);

ALTER TABLE room_clean_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_clean_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON room_clean_sessions
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid);
CREATE POLICY "owner_or_supervisor_write" ON room_clean_sessions
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid
    AND (
      housekeeper_id = (SELECT auth.uid())
      OR ((SELECT auth.jwt()) ->> 'user_role') IN ('gm', 'housekeeping_supervisor')
    )
  );

CREATE POLICY "tenant_read" ON room_clean_photos
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid);
CREATE POLICY "owner_or_supervisor_write" ON room_clean_photos
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'))::uuid
    AND (
      created_by = (SELECT auth.uid())
      OR ((SELECT auth.jwt()) ->> 'user_role') IN ('gm', 'housekeeping_supervisor')
    )
  );

-- Live updates for the web housekeeping board
ALTER PUBLICATION supabase_realtime ADD TABLE room_clean_sessions;
