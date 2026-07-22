-- Phase 3 workflow hardening. Complements the already-applied base schema in 070.

CREATE TABLE public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  role_label TEXT NOT NULL,
  phone TEXT NOT NULL,
  alternate_phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.emergency_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emergency_role TEXT NOT NULL,
  assigned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, emergency_role)
);

-- A registry of declared device contracts only; no third-party payload is accepted in Phase 3.
CREATE TABLE public.safety_device_intake_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  feature_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  event_schema JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_name)
);

CREATE TABLE public.emergency_drill_follow_up_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  drill_id UUID NOT NULL REFERENCES public.emergency_drills(id) ON DELETE RESTRICT,
  evidence_id UUID NOT NULL REFERENCES public.evidence_records(id) ON DELETE RESTRICT,
  linked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drill_id, evidence_id)
);

CREATE INDEX idx_safety_training_open_assignments
  ON public.safety_training_assignments (tenant_id, course_id, employee_id, due_date)
  WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.append_controlled_incident_event(
  p_incident_id UUID,
  p_tenant_id UUID,
  p_event_type TEXT,
  p_detail TEXT,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
) RETURNS public.controlled_incident_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_event public.controlled_incident_events;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.controlled_incidents
    WHERE id = p_incident_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Controlled incident not found for tenant';
  END IF;

  INSERT INTO public.controlled_incident_events (
    tenant_id, incident_id, event_type, detail, actor_id, actor_role, occurred_at
  ) VALUES (
    p_tenant_id, p_incident_id, p_event_type, p_detail, p_actor_id, p_actor_role, p_occurred_at
  ) RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_device_intake_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_drill_follow_up_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_emergency_contacts" ON public.emergency_contacts FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_emergency_role_assignments" ON public.emergency_role_assignments FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_safety_device_intake_contracts" ON public.safety_device_intake_contracts FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_emergency_drill_follow_up_evidence" ON public.emergency_drill_follow_up_evidence FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

REVOKE EXECUTE ON FUNCTION public.append_controlled_incident_event(UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_controlled_incident_event(UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
