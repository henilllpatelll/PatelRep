-- =============================================================================
-- Migration 043: API validation hardening support indexes
-- Adds idempotent indexes for high-frequency filtered list paths that now have
-- stricter page/search bounds at the API layer.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- /tasks base board: WHERE tenant_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_created_desc
  ON public.tasks (tenant_id, created_at DESC);

-- /tasks filters: WHERE tenant_id = ? AND assigned_to = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee_created_desc
  ON public.tasks (tenant_id, assigned_to, created_at DESC)
  WHERE assigned_to IS NOT NULL;

-- /tasks housekeeper view: assigned_to = me OR created_by = me.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_creator_created_desc
  ON public.tasks (tenant_id, created_by, created_at DESC)
  WHERE created_by IS NOT NULL;

-- /lost-found list/status/date filters.
CREATE INDEX IF NOT EXISTS idx_lost_found_tenant_created_desc
  ON public.lost_found_items (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lost_found_tenant_status_created_desc
  ON public.lost_found_items (tenant_id, status, created_at DESC);

-- /lost-found search uses ILIKE on description.
CREATE INDEX IF NOT EXISTS idx_lost_found_description_trgm
  ON public.lost_found_items
  USING gin (description gin_trgm_ops);

-- /housekeeping/inspections date/result queue.
CREATE INDEX IF NOT EXISTS idx_inspections_tenant_completed_desc
  ON public.inspections (tenant_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_inspections_tenant_result_completed_desc
  ON public.inspections (tenant_id, overall_result, completed_at DESC);

-- /staff/invitations pending invitation list.
CREATE INDEX IF NOT EXISTS idx_staff_invitations_tenant_pending_created_desc
  ON public.staff_invitations (tenant_id, created_at DESC)
  WHERE accepted_at IS NULL;
