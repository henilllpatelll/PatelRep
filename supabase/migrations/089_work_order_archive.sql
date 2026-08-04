-- Phase 15: soft-archive for work orders. Archiving is orthogonal to the
-- operational status state machine (services/work_orders/transitions.py) —
-- these are nullable timestamp/actor columns, not a new status value, so
-- existing status-transition logic and Kanban columns are untouched.
ALTER TABLE public.work_orders
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_work_orders_archived_at
  ON public.work_orders (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;
