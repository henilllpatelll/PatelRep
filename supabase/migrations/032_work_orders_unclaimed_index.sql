-- =============================================================================
-- Migration 032: Partial index for unclaimed work orders
-- Covers the second query in the split-OR engineer list pattern:
--   WHERE tenant_id = X AND assigned_to IS NULL ORDER BY created_at DESC
-- A partial index on NULL rows only is tiny (few unclaimed WOs at any time)
-- and makes the lookup essentially free regardless of table size.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_unclaimed
  ON work_orders (tenant_id, created_at DESC)
  WHERE assigned_to IS NULL;
