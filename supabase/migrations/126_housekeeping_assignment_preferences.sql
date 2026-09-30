-- Phase 2: operator-facing assignment behavior. Null remains safe because the
-- API supplies the legacy-compatible defaults for properties that have not saved.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS housekeeping_assignment_preferences JSONB;

COMMENT ON COLUMN public.tenants.housekeeping_assignment_preferences IS
  'Operational Auto-balance preferences: priority, staff eligibility, workload churn, and deterministic travel affinity.';
