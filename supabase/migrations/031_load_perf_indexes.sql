-- =============================================================================
-- Migration 031: Load-test performance indexes
-- Addresses p95 latency spikes (2–6s) observed under 40-worker concurrent load.
-- Root cause: room_assignments, guest_requests, and notifications had no
-- compound indexes covering the primary list-query filter + ORDER BY columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- room_assignments
-- /housekeeping/my-rooms query: tenant_id + assigned_to + assignment_date (all three)
-- /housekeeping/board date query: tenant_id + assignment_date
-- Without indexes this table did a full seq-scan on every request.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_room_assignments_tenant_date_assignee
  ON room_assignments (tenant_id, assignment_date, assigned_to);

-- Supervisor board only needs tenant + date — the above covers it as a prefix.
-- Add an explicit partial index so small date queries don't pull the assignee column.
CREATE INDEX IF NOT EXISTS idx_room_assignments_tenant_date
  ON room_assignments (tenant_id, assignment_date);

-- ---------------------------------------------------------------------------
-- guest_requests
-- List query: WHERE tenant_id = X ORDER BY created_at DESC
-- Filtered query: WHERE tenant_id = X AND status = Y ORDER BY created_at DESC
-- Without an index every call seq-scanned + sorted the whole table.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_guest_requests_tenant_created
  ON guest_requests (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_requests_tenant_status
  ON guest_requests (tenant_id, status);

-- ---------------------------------------------------------------------------
-- notifications
-- Query: WHERE user_id = X AND tenant_id = Y AND is_read = FALSE ORDER BY created_at DESC
-- Previous partial index idx_notifications_user_unread(user_id, is_read) lacked
-- tenant_id and created_at, forcing a post-filter sort on every unread poll.
-- We keep the original (it costs nothing) and add the covering index.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_tenant_unread_time
  ON notifications (user_id, tenant_id, created_at DESC)
  WHERE is_read = FALSE;

-- ---------------------------------------------------------------------------
-- work_orders
-- Ordered list query: WHERE tenant_id = X ORDER BY created_at DESC
-- Existing idx_work_orders_tenant_status(tenant_id, status) is optimal when
-- status is provided, but unfiltered calls fall back to a seq-scan + sort.
-- A (tenant_id, created_at DESC) index covers the base list efficiently.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_created
  ON work_orders (tenant_id, created_at DESC);
