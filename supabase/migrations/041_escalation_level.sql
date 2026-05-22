-- =============================================================================
-- Migration 041: Escalation level tracking on work_orders and tasks
-- Supports the 3-tier escalation ladder (notify supervisor → notify GM → auto-escalate).
-- Level 0 = no escalation, 1 = tier-1 notified, 2 = tier-2 notified, 3 = auto-escalated.
-- =============================================================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 3);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 3);

-- Allow "escalated" as a valid work_order status (tasks already support it)
ALTER TABLE work_orders
  DROP CONSTRAINT IF EXISTS work_orders_status_check;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_status_check
    CHECK (status IN ('open', 'in_progress', 'on_hold', 'completed', 'cancelled', 'escalated'));

-- Index for efficient escalation cron queries
CREATE INDEX IF NOT EXISTS idx_work_orders_escalation
  ON work_orders (tenant_id, escalation_level, due_at)
  WHERE status IN ('open', 'in_progress') AND assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_escalation
  ON tasks (tenant_id, escalation_level, due_at)
  WHERE status IN ('open', 'in_progress') AND priority = 'urgent' AND assigned_to IS NOT NULL;

COMMENT ON COLUMN work_orders.escalation_level IS '0=none, 1=supervisor notified, 2=GM notified, 3=auto-escalated';
COMMENT ON COLUMN tasks.escalation_level IS '0=none, 1=supervisor notified, 2=GM notified, 3=auto-escalated';
