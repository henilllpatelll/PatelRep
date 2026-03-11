-- =============================================================================
-- Migration 006: Tasks
-- General operational task management with AI creation and assignment tracking
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tasks
-- Core task record. Covers housekeeping requests, guest requests, engineering
-- work, lost & found, and general operations. Can be created by staff, AI
-- parsing natural language, or inbound guest requests.
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_number       SERIAL,                                -- human-readable sequential number
  title             TEXT        NOT NULL,
  description       TEXT,
  original_nl_input TEXT,                                  -- raw natural language input from staff/AI

  task_type         TEXT        NOT NULL CHECK (task_type IN (
                      'housekeeping',
                      'engineering',
                      'guest_request',
                      'lost_found',
                      'general'
                    )),

  priority          TEXT        NOT NULL DEFAULT 'normal' CHECK (priority IN (
                      'urgent',   -- immediate attention required
                      'normal',   -- standard priority
                      'low'       -- complete when convenient
                    )),

  status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open',
                      'in_progress',
                      'completed',
                      'cancelled',
                      'escalated'
                    )),

  -- Location
  room_id           UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  location_text     TEXT,                                  -- free-text for non-room locations

  -- Assignment
  department_id     UUID        REFERENCES departments(id) ON DELETE SET NULL,
  assigned_to       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by        UUID        NOT NULL REFERENCES auth.users(id),

  -- AI metadata
  is_ai_created     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_ai_assigned    BOOLEAN     NOT NULL DEFAULT FALSE,
  ai_confidence     DECIMAL(3,2),                          -- 0.00–1.00 confidence of AI classification

  -- SLA tracking
  sla_minutes       INT         NOT NULL DEFAULT 240,      -- 4-hour default SLA
  due_at            TIMESTAMPTZ,

  -- Lifecycle timestamps
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  escalation_reason TEXT,

  -- Metadata
  tags              TEXT[]      DEFAULT '{}',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tasks IS 'Operational task management. Covers HK, engineering, guest requests, and general operations.';
COMMENT ON COLUMN tasks.task_number IS 'Auto-incrementing human-readable task number. Not globally unique across tenants.';
COMMENT ON COLUMN tasks.original_nl_input IS 'Raw natural language text when task was created via AI voice/text parsing.';
COMMENT ON COLUMN tasks.ai_confidence IS 'AI classification confidence score (0.00–1.00) for task type and assignment.';
COMMENT ON COLUMN tasks.sla_minutes IS 'Service Level Agreement target in minutes. Breaches trigger escalation notifications.';

-- ---------------------------------------------------------------------------
-- task_comments
-- Threaded comments and system event log for a task. Soft deletes not
-- supported — comments cascade-delete with the parent task.
-- ---------------------------------------------------------------------------
CREATE TABLE task_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id),
  comment     TEXT        NOT NULL,
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,          -- true for automated system messages
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE task_comments IS 'User comments and system event entries on tasks. Cascade-deleted with parent task.';
COMMENT ON COLUMN task_comments.is_system IS 'True for automated messages (status changes, escalations, assignments).';
