-- Phase 1: Canonical work-order states and append-only operational history.

ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS work_orders_priority_check;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_priority_check
  CHECK (priority IN ('emergency', 'urgent', 'normal', 'low'));

ALTER TABLE public.work_orders
  DROP CONSTRAINT IF EXISTS work_orders_status_check;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_status_check
  CHECK (status IN ('open', 'escalated', 'in_progress', 'on_hold', 'completed', 'cancelled'));

CREATE TABLE public.operational_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  old_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_code TEXT,
  reason_note TEXT,
  source TEXT NOT NULL CHECK (source IN ('web', 'mobile', 'api', 'automation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operational_audit_events IS
  'Append-only, tenant-scoped history for controlled operational changes.';

CREATE INDEX idx_operational_audit_events_resource
  ON public.operational_audit_events (tenant_id, resource_type, resource_id, created_at DESC);

ALTER TABLE public.operational_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_operational_audit_read" ON public.operational_audit_events
  FOR SELECT
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE OR REPLACE FUNCTION public.prevent_operational_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operational audit events are append-only';
END;
$$;

CREATE TRIGGER operational_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.operational_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operational_audit_mutation();

CREATE OR REPLACE FUNCTION public.transition_work_order_with_audit(
  p_work_order_id UUID,
  p_tenant_id UUID,
  p_new_status TEXT,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_reason_code TEXT,
  p_reason_note TEXT,
  p_source TEXT,
  p_is_override BOOLEAN,
  p_assigned_to UUID DEFAULT NULL
)
RETURNS SETOF public.work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.work_orders;
  v_updated public.work_orders;
BEGIN
  SELECT * INTO v_current
  FROM public.work_orders
  WHERE id = p_work_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order not found';
  END IF;

  UPDATE public.work_orders
  SET
    status = p_new_status,
    assigned_to = COALESCE(p_assigned_to, assigned_to),
    started_at = CASE
      WHEN p_new_status IN ('in_progress', 'escalated') AND started_at IS NULL THEN now()
      ELSE started_at
    END,
    completed_at = CASE
      WHEN p_new_status = 'completed' THEN now()
      WHEN p_new_status = 'open' THEN NULL
      ELSE completed_at
    END,
    updated_at = now()
  WHERE id = p_work_order_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_updated;

  INSERT INTO public.operational_audit_events (
    tenant_id, resource_type, resource_id, action, actor_id, actor_role,
    old_state, new_state, reason_code, reason_note, source
  ) VALUES (
    p_tenant_id,
    'work_order',
    p_work_order_id,
    CASE WHEN p_is_override THEN 'work_order.transition_overridden' ELSE 'work_order.transitioned' END,
    p_actor_id,
    p_actor_role,
    jsonb_build_object('status', v_current.status),
    jsonb_build_object('status', v_updated.status),
    p_reason_code,
    p_reason_note,
    p_source
  );

  RETURN NEXT v_updated;
END;
$$;
