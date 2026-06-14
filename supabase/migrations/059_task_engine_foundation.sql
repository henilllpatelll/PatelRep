-- =============================================================================
-- Migration 059: Pivot Task Engine Foundation
-- Additive data model for the housekeeping/maintenance/OPERA execution pivot.
-- Existing /tasks API behavior remains supported by keeping legacy task values
-- in the widened CHECK constraints.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Room execution fields
-- ---------------------------------------------------------------------------
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS opera_status TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS patelrep_status TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS occupancy_status TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS arrival_departure_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS assigned_housekeeper UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS due_time TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS open_issues JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mismatch_flag BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rooms.opera_status IS 'Latest OPERA Cloud room status code observed by PatelRep.';
COMMENT ON COLUMN rooms.patelrep_status IS 'PatelRep operational room status used by floor staff.';
COMMENT ON COLUMN rooms.occupancy_status IS 'Current occupancy context such as occupied, vacant, departed, arrival, or out_of_order.';
COMMENT ON COLUMN rooms.arrival_departure_context IS 'JSON context from PMS/manual front desk entry for arrivals, departures, stayovers, and late checkout.';
COMMENT ON COLUMN rooms.assigned_housekeeper IS 'Current execution owner for room-cleaning work, if assigned.';
COMMENT ON COLUMN rooms.due_time IS 'Operational due time for the next room action.';
COMMENT ON COLUMN rooms.open_issues IS 'Small JSON list of open issues visible on room/task surfaces.';
COMMENT ON COLUMN rooms.mismatch_flag IS 'True when OPERA and PatelRep room status disagree and need review.';

-- ---------------------------------------------------------------------------
-- Widen existing tasks table for pivot categories/statuses.
-- Keep legacy values so current API/mobile/web clients continue working.
-- ---------------------------------------------------------------------------
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (task_type IN (
  'housekeeping',
  'engineering',
  'guest_request',
  'lost_found',
  'general',
  'housekeeping_room_clean',
  'housekeeping_guest_request',
  'maintenance_work_order',
  'room_status_mismatch',
  'pms_note_request',
  'ai_failure',
  'manager_review'
));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN (
  'low',
  'normal',
  'high',
  'urgent'
));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'open',
  'new',
  'assigned',
  'acknowledged',
  'in_progress',
  'blocked',
  'pending_approval',
  'completed',
  'verified',
  'escalated',
  'cancelled',
  'canceled'
));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS room_or_area TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS issue_category TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS guest_facing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_tech UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_verification JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

COMMENT ON COLUMN tasks.room_or_area IS 'Maintenance target such as room number, public area, or equipment location.';
COMMENT ON COLUMN tasks.issue_category IS 'Maintenance/operations issue category such as hvac, plumbing, linen, or status_mismatch.';
COMMENT ON COLUMN tasks.guest_facing IS 'True when the issue is visible to or reported by a guest.';
COMMENT ON COLUMN tasks.blocked_reason IS 'Reason the task cannot currently move forward.';
COMMENT ON COLUMN tasks.assigned_tech IS 'Maintenance technician assigned to work-order style tasks.';
COMMENT ON COLUMN tasks.completion_verification IS 'JSON verification metadata such as photos, checklist, verifier, or agent result.';

-- ---------------------------------------------------------------------------
-- Task assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assigned_to  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reassigned', 'completed', 'canceled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ
);

COMMENT ON TABLE task_assignments IS 'Assignment history for task execution owners.';

-- ---------------------------------------------------------------------------
-- Task notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL,
  is_internal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE task_notes IS 'Human-readable notes attached to task execution.';

-- ---------------------------------------------------------------------------
-- Task photos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_url  TEXT NOT NULL,
  thumbnail_url TEXT,
  content_type TEXT,
  byte_size    INT,
  width        INT,
  height       INT,
  captured_at  TIMESTAMPTZ,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE task_photos IS 'Photo metadata for task evidence; binary files live in storage buckets.';

-- ---------------------------------------------------------------------------
-- Approval requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id               UUID REFERENCES tasks(id) ON DELETE SET NULL,
  proposed_action       TEXT NOT NULL,
  proposed_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level            TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  requested_by_agent_id UUID,
  approved_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'edited', 'rejected', 'expired')),
  edited_payload        JSONB,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE approval_requests IS 'Manager approval queue for higher-risk agent proposed actions.';

-- ---------------------------------------------------------------------------
-- Audit events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type          TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id            TEXT,
  room_id             UUID REFERENCES rooms(id) ON DELETE SET NULL,
  task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
  event_type          TEXT NOT NULL,
  before_snapshot_ref JSONB,
  after_snapshot_ref  JSONB,
  action_attempted    TEXT,
  verifier_result     JSONB,
  confidence          DECIMAL(5,4),
  error_message       TEXT,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tenant_id = property_id)
);

COMMENT ON TABLE audit_events IS 'Append-only operational audit events for users, agents, and system actions.';

-- ---------------------------------------------------------------------------
-- PMS snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'opera_cloud',
  external_property_id TEXT,
  snapshot_type        TEXT NOT NULL,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tenant_id = property_id)
);

COMMENT ON TABLE pms_snapshots IS 'Read-only PMS state snapshots. This foundation does not automate OPERA Cloud writes.';

-- ---------------------------------------------------------------------------
-- Agent runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_name     TEXT NOT NULL,
  agent_type     TEXT,
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  input_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence     DECIMAL(5,4),
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tenant_id = property_id)
);

COMMENT ON TABLE agent_runs IS 'Execution trace for PatelRep AI/system agents.';

-- ---------------------------------------------------------------------------
-- Escalation events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalation_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id               UUID REFERENCES rooms(id) ON DELETE SET NULL,
  task_id               UUID REFERENCES tasks(id) ON DELETE CASCADE,
  reason                TEXT NOT NULL,
  escalation_level      INT NOT NULL DEFAULT 1,
  escalated_to_department TEXT,
  escalated_to_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_actor_type TEXT NOT NULL DEFAULT 'system' CHECK (created_by_actor_type IN ('user', 'agent', 'system')),
  created_by_actor_id   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tenant_id = property_id)
);

COMMENT ON TABLE escalation_events IS 'Escalation trail for tasks needing supervisor, maintenance, manager, or system attention.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status_priority_due ON tasks(tenant_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_type_status ON tasks(tenant_id, task_type, status);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant_mismatch ON rooms(tenant_id, mismatch_flag) WHERE mismatch_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_task_assignments_tenant_task ON task_assignments(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_notes_tenant_task_created ON task_notes(tenant_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_photos_tenant_task_created ON task_photos(tenant_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status ON approval_requests(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_task_timestamp ON audit_events(tenant_id, task_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_room_timestamp ON audit_events(tenant_id, room_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pms_snapshots_tenant_type_captured ON pms_snapshots(tenant_id, snapshot_type, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status_created ON agent_runs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalation_events_tenant_task_created ON escalation_events(tenant_id, task_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pms_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON task_assignments FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON task_notes FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON task_photos FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON approval_requests FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON audit_events FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON pms_snapshots FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON agent_runs FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
CREATE POLICY "tenant_isolation_select" ON escalation_events FOR SELECT USING (tenant_id::text = (auth.jwt() ->> 'hotel_id'));
