-- Phase 9: property-scoped, backwards-compatible workload configuration.
-- Nullable settings retain the proven legacy fallback until a GM saves a value.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS housekeeping_target_credits NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS housekeeping_credit_weights JSONB,
  ADD COLUMN IF NOT EXISTS housekeeping_capacity_overrides JSONB;

COMMENT ON COLUMN public.tenants.housekeeping_target_credits IS
  'Default daily workload credits per attendant; null uses the legacy 16-credit fallback.';
COMMENT ON COLUMN public.tenants.housekeeping_credit_weights IS
  'Relative DEP/FULL/LIGHT workload weights; null uses legacy 3/2/1 values.';
COMMENT ON COLUMN public.tenants.housekeeping_capacity_overrides IS
  'Optional per-staff daily workload target keyed by user id.';
