-- Phase 4: defensible recurring engineering and housekeeping programs.
-- Completion, deferral, and welfare-event rows are append-only records.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS criticality TEXT NOT NULL DEFAULT 'medium' CHECK (criticality IN ('low', 'medium', 'high', 'life_safety')),
  ADD COLUMN IF NOT EXISTS downtime_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warranty_terms TEXT,
  ADD COLUMN IF NOT EXISTS annual_maintenance_cost NUMERIC(12,2);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS pm_completion_id UUID;

CREATE TABLE public.pm_checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  program_area TEXT NOT NULL CHECK (program_area IN ('engineering', 'housekeeping')),
  name TEXT NOT NULL,
  name_es TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version)
);

CREATE TABLE public.pm_completion_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pm_schedule_id UUID NOT NULL REFERENCES public.pm_schedules(id) ON DELETE RESTRICT,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  checklist_template_id UUID REFERENCES public.pm_checklist_templates(id) ON DELETE SET NULL,
  checklist_version INTEGER,
  technician_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  verifier_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
  meter_readings JSONB NOT NULL DEFAULT '{}'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  labor_minutes INTEGER NOT NULL DEFAULT 0 CHECK (labor_minutes >= 0),
  parts_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  vendor_name TEXT,
  certificate_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pm_completion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  completion_id UUID NOT NULL REFERENCES public.pm_completion_records(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'not_applicable')),
  requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.pm_deferrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pm_schedule_id UUID NOT NULL REFERENCES public.pm_schedules(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  deferred_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.public_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_detail TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE public.deep_clean_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'public_area')),
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  public_area_id UUID REFERENCES public.public_areas(id) ON DELETE CASCADE,
  checklist_template_id UUID REFERENCES public.pm_checklist_templates(id) ON DELETE SET NULL,
  interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
  next_due_on DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((target_type = 'room' AND room_id IS NOT NULL AND public_area_id IS NULL) OR (target_type = 'public_area' AND public_area_id IS NOT NULL AND room_id IS NULL))
);

CREATE TABLE public.deep_clean_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES public.deep_clean_schedules(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  checklist_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.inspection_sampling_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_type_id UUID REFERENCES public.room_types(id) ON DELETE CASCADE,
  experience_band TEXT NOT NULL DEFAULT 'standard' CHECK (experience_band IN ('new_hire', 'standard', 'trusted')),
  risk_level TEXT NOT NULL DEFAULT 'standard' CHECK (risk_level IN ('standard', 'high')),
  sample_percent INTEGER NOT NULL CHECK (sample_percent BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, room_type_id, experience_band, risk_level)
);

CREATE TABLE public.housekeeping_supply_pars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supply_type TEXT NOT NULL CHECK (supply_type IN ('linen', 'chemical', 'amenity')),
  name TEXT NOT NULL,
  on_hand NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  par_level NUMERIC(12,2) NOT NULL CHECK (par_level >= 0),
  unit TEXT NOT NULL DEFAULT 'each',
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supply_type, name)
);

CREATE TABLE public.housekeeping_stayover_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  linen_change_frequency_days INTEGER NOT NULL DEFAULT 3 CHECK (linen_change_frequency_days BETWEEN 1 AND 30),
  opt_out_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.dnd_welfare_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  threshold_hours INTEGER NOT NULL DEFAULT 8 CHECK (threshold_hours BETWEEN 1 AND 72),
  escalation_roles TEXT[] NOT NULL DEFAULT ARRAY['housekeeping_supervisor', 'front_desk'],
  escalation_instructions TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.dnd_welfare_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  dnd_started_at TIMESTAMPTZ NOT NULL,
  threshold_hours INTEGER NOT NULL,
  escalated_to TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, room_id, dnd_started_at)
);

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_pm_completion_fk
  FOREIGN KEY (pm_completion_id) REFERENCES public.pm_completion_records(id) ON DELETE SET NULL;

CREATE INDEX idx_pm_completion_records_history ON public.pm_completion_records (tenant_id, pm_schedule_id, completed_at DESC);
CREATE INDEX idx_deep_clean_schedules_due ON public.deep_clean_schedules (tenant_id, next_due_on) WHERE is_active;
CREATE INDEX idx_dnd_welfare_events_room ON public.dnd_welfare_events (tenant_id, room_id, dnd_started_at DESC);

CREATE OR REPLACE FUNCTION public.reject_operational_program_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operational program records are append-only; add a new event or completion record instead.'; END; $$;
CREATE TRIGGER pm_completion_records_immutable BEFORE UPDATE OR DELETE ON public.pm_completion_records FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER pm_completion_items_immutable BEFORE UPDATE OR DELETE ON public.pm_completion_items FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER pm_deferrals_immutable BEFORE UPDATE OR DELETE ON public.pm_deferrals FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER deep_clean_occurrences_immutable BEFORE UPDATE OR DELETE ON public.deep_clean_occurrences FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
CREATE TRIGGER dnd_welfare_events_immutable BEFORE UPDATE OR DELETE ON public.dnd_welfare_events FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();

ALTER TABLE public.pm_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_completion_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_completion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_deferrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deep_clean_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deep_clean_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_sampling_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.housekeeping_supply_pars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.housekeeping_stayover_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnd_welfare_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dnd_welfare_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_pm_checklist_templates" ON public.pm_checklist_templates FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_pm_completion_records" ON public.pm_completion_records FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_pm_completion_items" ON public.pm_completion_items FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_pm_deferrals" ON public.pm_deferrals FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_public_areas" ON public.public_areas FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_deep_clean_schedules" ON public.deep_clean_schedules FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_deep_clean_occurrences" ON public.deep_clean_occurrences FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_inspection_sampling_rules" ON public.inspection_sampling_rules FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_housekeeping_supply_pars" ON public.housekeeping_supply_pars FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_housekeeping_stayover_rules" ON public.housekeeping_stayover_rules FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_dnd_welfare_policies" ON public.dnd_welfare_policies FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_dnd_welfare_events" ON public.dnd_welfare_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
