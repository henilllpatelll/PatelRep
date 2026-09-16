-- =============================================================================
-- Migration 104: Engineering Work Order Labor + Cost Capture
-- Adds the rate/cost columns needed to turn already-captured labor_hours and
-- parts_consumed into a dollar cost stored on the work order at completion
-- time (Phase 38). Nullable throughout: a hotel doesn't have to backfill
-- rates/costs before this ships, and NULL always means "unknown" — it is
-- never treated as a $0 cost. Computed once at completion in application
-- code (apps/api/routers/work_orders.py complete_work_order), not
-- recomputed retroactively if rates/unit costs change later.
-- =============================================================================

ALTER TABLE public.user_roles
  ADD COLUMN hourly_rate NUMERIC(8,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0);

COMMENT ON COLUMN public.user_roles.hourly_rate IS 'Staff hourly labor rate. GM-set and GM-only visible in API responses. NULL = not on file; never defaults to 0.';

ALTER TABLE public.engineering_parts
  ADD COLUMN unit_cost NUMERIC(10,2) CHECK (unit_cost IS NULL OR unit_cost >= 0);

COMMENT ON COLUMN public.engineering_parts.unit_cost IS 'Cost per unit of this part, used to compute work_orders.parts_cost at WO completion. NULL = unknown, contributes 0 to parts_cost.';

ALTER TABLE public.work_orders
  ADD COLUMN labor_cost NUMERIC(10,2),
  ADD COLUMN parts_cost NUMERIC(10,2),
  ADD COLUMN total_cost NUMERIC(10,2);

COMMENT ON COLUMN public.work_orders.labor_cost IS 'labor_hours * assignee hourly_rate at the moment of completion, computed in application code. NULL if no hourly_rate was on file. Not recomputed retroactively.';
COMMENT ON COLUMN public.work_orders.parts_cost IS 'SUM(quantity * unit_cost) across parts_consumed at completion. Parts with unknown unit_cost contribute 0. NULL only when no parts were consumed.';
COMMENT ON COLUMN public.work_orders.total_cost IS 'COALESCE(labor_cost,0) + COALESCE(parts_cost,0), written only when at least one of the two is non-NULL. NULL means no cost data at all, never zero cost.';
