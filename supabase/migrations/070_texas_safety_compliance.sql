-- Phase 3: Texas compliance and staff safety. Base incident rows are immutable;
-- all corrections, reviews, follow-up, and closure information is append-only.

CREATE TABLE public.safety_training_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  course_name TEXT NOT NULL,
  course_code TEXT,
  covered_roles TEXT[] NOT NULL,
  new_hire_deadline_days INTEGER NOT NULL DEFAULT 30 CHECK (new_hire_deadline_days BETWEEN 1 AND 365),
  recurrence_months INTEGER NOT NULL DEFAULT 12 CHECK (recurrence_months BETWEEN 1 AND 60),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_training_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.safety_training_courses(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  certificate_evidence_id UUID REFERENCES public.evidence_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, course_id, employee_id, due_date)
);

CREATE TABLE public.controlled_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('guest_injury', 'employee_injury', 'chemical_exposure', 'sharps_body_fluid', 'security', 'privacy', 'discrimination', 'police_fire', 'life_safety_impairment')),
  occurred_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  people_involved JSONB NOT NULL DEFAULT '[]'::jsonb,
  witnesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  immediate_containment TEXT NOT NULL,
  details TEXT NOT NULL,
  follow_up_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  retention_until DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '7 years'),
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.controlled_incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES public.controlled_incidents(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'correction', 'manager_review', 'follow_up', 'closed')),
  detail TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.chemical_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  manufacturer TEXT,
  storage_location TEXT NOT NULL,
  sds_evidence_id UUID REFERENCES public.evidence_records(id) ON DELETE SET NULL,
  secondary_label_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ppe_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.emergency_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  drill_type TEXT NOT NULL CHECK (drill_type IN ('fire', 'severe_weather', 'evacuation', 'medical', 'security', 'spill_exposure')),
  occurred_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.emergency_drill_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  drill_id UUID NOT NULL REFERENCES public.emergency_drills(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accountability_status TEXT NOT NULL CHECK (accountability_status IN ('accounted_for', 'absent', 'assisted')),
  acknowledged_at TIMESTAMPTZ NOT NULL,
  UNIQUE (drill_id, employee_id)
);

CREATE INDEX idx_safety_training_assignments_due ON public.safety_training_assignments (tenant_id, employee_id, due_date);
CREATE INDEX idx_controlled_incidents_retention ON public.controlled_incidents (tenant_id, retention_until, legal_hold);
CREATE INDEX idx_controlled_incident_events_history ON public.controlled_incident_events (tenant_id, incident_id, occurred_at);

CREATE OR REPLACE FUNCTION public.reject_controlled_incident_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Controlled incidents are append-only; add a controlled_incident_event instead.'; END; $$;
CREATE TRIGGER controlled_incidents_immutable BEFORE UPDATE OR DELETE ON public.controlled_incidents FOR EACH ROW EXECUTE FUNCTION public.reject_controlled_incident_mutation();
CREATE TRIGGER controlled_incident_events_immutable BEFORE UPDATE OR DELETE ON public.controlled_incident_events FOR EACH ROW EXECUTE FUNCTION public.reject_controlled_incident_mutation();

ALTER TABLE public.safety_training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_drill_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_safety_training_courses" ON public.safety_training_courses FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_safety_training_assignments" ON public.safety_training_assignments FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_controlled_incidents" ON public.controlled_incidents FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_controlled_incident_events" ON public.controlled_incident_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_chemical_inventory" ON public.chemical_inventory FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_emergency_drills" ON public.emergency_drills FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_emergency_drill_participants" ON public.emergency_drill_participants FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
