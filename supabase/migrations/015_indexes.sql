-- =============================================================================
-- Migration 015: Performance Indexes
-- All non-primary-key indexes for query optimization across the schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tasks
-- High-frequency queries: tenant dashboard (tenant+status), assignee workload
-- (assigned_to+status), room task history (room_id), time-range reports (created_at)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_tasks_tenant_status
  ON tasks (tenant_id, status);

CREATE INDEX idx_tasks_assigned_to_status
  ON tasks (assigned_to, status);

CREATE INDEX idx_tasks_room_id
  ON tasks (room_id);

CREATE INDEX idx_tasks_created_at
  ON tasks (created_at DESC);

-- ---------------------------------------------------------------------------
-- work_orders
-- Tenant WO board, asset history, engineer workload, time-range reports
-- ---------------------------------------------------------------------------
CREATE INDEX idx_work_orders_tenant_status
  ON work_orders (tenant_id, status);

CREATE INDEX idx_work_orders_asset_id
  ON work_orders (asset_id);

CREATE INDEX idx_work_orders_assigned_to
  ON work_orders (assigned_to);

CREATE INDEX idx_work_orders_created_at
  ON work_orders (created_at DESC);

-- ---------------------------------------------------------------------------
-- room_status
-- Live status board (tenant+status filter), supervisor assignment view
-- ---------------------------------------------------------------------------
CREATE INDEX idx_room_status_tenant_status
  ON room_status (tenant_id, status);

CREATE INDEX idx_room_status_assigned_to
  ON room_status (assigned_to);

-- ---------------------------------------------------------------------------
-- room_status_history
-- Room timeline queries and audit lookups by room ordered by time
-- ---------------------------------------------------------------------------
CREATE INDEX idx_room_status_history_room_created
  ON room_status_history (room_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- notifications
-- Unread notification badge count and notification list (partial index on
-- unread rows only — avoids scanning read rows which are the majority)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, is_read)
  WHERE is_read = FALSE;

-- ---------------------------------------------------------------------------
-- ai_interactions
-- Billing period usage rollups and per-tenant AI analytics
-- ---------------------------------------------------------------------------
CREATE INDEX idx_ai_interactions_tenant_created
  ON ai_interactions (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- opera_reservations
-- Front desk arrival view (tenant + arrival date range) is the primary query
-- ---------------------------------------------------------------------------
CREATE INDEX idx_opera_reservations_tenant_arrival
  ON opera_reservations (tenant_id, arrival_date);

-- ---------------------------------------------------------------------------
-- shift_assignments
-- Daily schedule view: all assignments for a tenant on a given work date
-- ---------------------------------------------------------------------------
CREATE INDEX idx_shift_assignments_tenant_date
  ON shift_assignments (tenant_id, work_date);

-- ---------------------------------------------------------------------------
-- sop_chunks
-- Tenant filter applied before vector similarity search to narrow candidates
-- (separate from the IVFFlat vector index created in migration 010)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_sop_chunks_tenant_id
  ON sop_chunks (tenant_id);

-- ---------------------------------------------------------------------------
-- logbook_entries
-- Logbook view filtered by tenant and date range
-- ---------------------------------------------------------------------------
CREATE INDEX idx_logbook_entries_tenant_date
  ON logbook_entries (tenant_id, entry_date DESC);

-- ---------------------------------------------------------------------------
-- housekeeper_profiles
-- Lookup by user + tenant for AI prediction engine joins
-- ---------------------------------------------------------------------------
CREATE INDEX idx_housekeeper_profiles_user_tenant
  ON housekeeper_profiles (user_id, tenant_id);

-- ---------------------------------------------------------------------------
-- failure_predictions
-- GM dashboard "high risk assets" view sorted by risk score descending
-- ---------------------------------------------------------------------------
CREATE INDEX idx_failure_predictions_tenant_risk
  ON failure_predictions (tenant_id, risk_score DESC);
