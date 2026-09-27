-- Phase 9: first-class, tenant-scoped engineering condition monitoring.
-- PM JSON remains immutable evidence; these rows are the queryable trend history.

CREATE TABLE public.asset_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  location_text TEXT,
  name TEXT NOT NULL,
  meter_type TEXT NOT NULL CHECK (meter_type IN (
    'temperature', 'pressure', 'voltage', 'current', 'runtime_hours',
    'cycle_count', 'ph', 'chlorine', 'humidity', 'flow', 'energy', 'water', 'custom'
  )),
  unit TEXT NOT NULL,
  warning_low NUMERIC,
  warning_high NUMERIC,
  critical_low NUMERIC,
  critical_high NUMERIC,
  stale_after_hours INTEGER CHECK (stale_after_hours IS NULL OR stale_after_hours > 0),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'pm', 'iot')),
  critical_action TEXT NOT NULL DEFAULT 'none' CHECK (critical_action IN ('none', 'create_work_order')),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (asset_id IS NOT NULL OR NULLIF(BTRIM(location_text), '') IS NOT NULL),
  CHECK (critical_low IS NULL OR warning_low IS NULL OR critical_low <= warning_low),
  CHECK (warning_high IS NULL OR critical_high IS NULL OR warning_high <= critical_high)
);

CREATE UNIQUE INDEX asset_meters_unique_asset_name
  ON public.asset_meters (tenant_id, asset_id, lower(name)) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX asset_meters_unique_location_name
  ON public.asset_meters (tenant_id, lower(location_text), lower(name)) WHERE asset_id IS NULL;
CREATE INDEX asset_meters_tenant_asset_active
  ON public.asset_meters (tenant_id, asset_id, is_active);

CREATE TABLE public.meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.asset_meters(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'pm', 'iot')),
  status_at_recording TEXT NOT NULL CHECK (status_at_recording IN ('normal', 'warning', 'critical')),
  warning_low_snapshot NUMERIC,
  warning_high_snapshot NUMERIC,
  critical_low_snapshot NUMERIC,
  critical_high_snapshot NUMERIC,
  pm_completion_id UUID REFERENCES public.pm_completion_records(id) ON DELETE SET NULL,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX meter_readings_meter_recorded_at ON public.meter_readings (meter_id, recorded_at DESC);
CREATE INDEX meter_readings_tenant_recorded_at ON public.meter_readings (tenant_id, recorded_at DESC);
CREATE INDEX meter_readings_tenant_status_recorded_at ON public.meter_readings (tenant_id, status_at_recording, recorded_at DESC);
CREATE INDEX meter_readings_pm_completion ON public.meter_readings (pm_completion_id) WHERE pm_completion_id IS NOT NULL;
CREATE INDEX meter_readings_work_order ON public.meter_readings (work_order_id) WHERE work_order_id IS NOT NULL;

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS condition_meter_id UUID
  REFERENCES public.asset_meters(id) ON DELETE SET NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS triggering_meter_reading_id UUID
  REFERENCES public.meter_readings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX work_orders_one_active_condition_per_meter
  ON public.work_orders (tenant_id, condition_meter_id)
  WHERE status IN ('open', 'escalated', 'in_progress', 'on_hold')
    AND condition_meter_id IS NOT NULL;

ALTER TABLE public.asset_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_meters_tenant_access ON public.asset_meters FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY meter_readings_tenant_access ON public.meter_readings FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid)
  WITH CHECK (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

COMMENT ON TABLE public.asset_meters IS
  'Canonical meter definition. Unit cannot change after readings exist through the API.';
COMMENT ON TABLE public.meter_readings IS
  'Append-only condition evidence. status_at_recording preserves the historical threshold decision.';
