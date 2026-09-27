-- Phase 6: immutable work-order operational timing and explicit labor sessions.
-- Events answer workflow timing questions; sessions answer paid active-work time.

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;

CREATE TABLE public.work_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('acknowledged','assigned','arrived','work_started','work_paused','work_resumed','work_completed','reopened')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_order_events_timeline
  ON public.work_order_events (tenant_id, work_order_id, occurred_at);

CREATE TABLE public.work_order_labor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_minutes NUMERIC(10,2),
  hourly_rate_snapshot NUMERIC(8,2),
  labor_cost NUMERIC(10,2),
  ended_reason TEXT CHECK (ended_reason IN ('paused','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_work_order_labor_sessions_timeline
  ON public.work_order_labor_sessions (tenant_id, work_order_id, started_at);
CREATE UNIQUE INDEX one_active_engineering_labor_session_per_staff
  ON public.work_order_labor_sessions (tenant_id, staff_user_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_labor_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_work_order_events_read ON public.work_order_events FOR SELECT
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY tenant_work_order_labor_sessions_read ON public.work_order_labor_sessions FOR SELECT
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE OR REPLACE FUNCTION public.prevent_work_order_timing_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Work order timing records are immutable';
END;
$$;
CREATE TRIGGER work_order_events_append_only BEFORE UPDATE OR DELETE ON public.work_order_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_timing_mutation();
CREATE TRIGGER work_order_labor_sessions_append_only BEFORE DELETE ON public.work_order_labor_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_timing_mutation();

CREATE OR REPLACE FUNCTION public.apply_work_order_timing_action(
  p_work_order_id UUID, p_tenant_id UUID, p_actor_id UUID, p_action TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wo public.work_orders;
  v_active public.work_order_labor_sessions;
  v_rate NUMERIC(8,2);
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_work_order_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF p_action NOT IN ('acknowledge','arrive','start','pause','complete','reopen','claim') THEN
    RAISE EXCEPTION 'unsupported timing action';
  END IF;

  -- Fast, idempotent progression: never insert a duplicate first event.
  IF p_action IN ('acknowledge','arrive','start','claim')
     AND NOT EXISTS (SELECT 1 FROM public.work_order_events WHERE work_order_id=p_work_order_id AND event_type='acknowledged') THEN
    INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id)
    VALUES(p_tenant_id,p_work_order_id,'acknowledged',v_now,p_actor_id,p_actor_id);
    UPDATE public.work_orders SET acknowledged_at=v_now, updated_at=v_now WHERE id=p_work_order_id;
  END IF;
  IF p_action='claim' AND NOT EXISTS (SELECT 1 FROM public.work_order_events WHERE work_order_id=p_work_order_id AND event_type='assigned' AND staff_user_id=p_actor_id) THEN
    INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id)
    VALUES(p_tenant_id,p_work_order_id,'assigned',v_now,p_actor_id,p_actor_id);
  END IF;
  IF p_action IN ('arrive','start') AND NOT EXISTS (SELECT 1 FROM public.work_order_events WHERE work_order_id=p_work_order_id AND event_type='arrived') THEN
    INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id)
    VALUES(p_tenant_id,p_work_order_id,'arrived',v_now,p_actor_id,p_actor_id);
    UPDATE public.work_orders SET arrived_at=v_now, updated_at=v_now WHERE id=p_work_order_id;
  END IF;

  IF p_action='arrive' THEN
    RETURN jsonb_build_object('status','arrived');
  ELSIF p_action IN ('start','pause','complete') THEN
    SELECT * INTO v_active FROM public.work_order_labor_sessions
      WHERE tenant_id=p_tenant_id AND staff_user_id=p_actor_id AND ended_at IS NULL FOR UPDATE;
    IF p_action='start' THEN
      IF FOUND AND v_active.work_order_id = p_work_order_id THEN
        RETURN jsonb_build_object('status','already_running','session_id',v_active.id);
      ELSIF FOUND THEN
        RAISE EXCEPTION 'active labor session exists for another work order: %', v_active.work_order_id USING ERRCODE='P0001';
      END IF;
      SELECT hourly_rate INTO v_rate FROM public.user_roles WHERE tenant_id=p_tenant_id AND user_id=p_actor_id AND is_active=true LIMIT 1;
      INSERT INTO public.work_order_labor_sessions(tenant_id,work_order_id,staff_user_id,started_at,hourly_rate_snapshot)
        VALUES(p_tenant_id,p_work_order_id,p_actor_id,v_now,v_rate);
      INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id)
        VALUES(p_tenant_id,p_work_order_id,CASE WHEN EXISTS (SELECT 1 FROM public.work_order_events WHERE work_order_id=p_work_order_id AND event_type='work_started') THEN 'work_resumed' ELSE 'work_started' END,v_now,p_actor_id,p_actor_id);
      RETURN jsonb_build_object('status','running');
    ELSIF p_action='pause' THEN
      IF NOT FOUND OR v_active.work_order_id <> p_work_order_id THEN RETURN jsonb_build_object('status','not_running'); END IF;
      UPDATE public.work_order_labor_sessions SET ended_at=v_now, duration_minutes=round(extract(epoch FROM (v_now-started_at))/60.0,2), labor_cost=CASE WHEN hourly_rate_snapshot IS NULL THEN NULL ELSE round(extract(epoch FROM (v_now-started_at))/3600.0*hourly_rate_snapshot,2) END, ended_reason='paused' WHERE id=v_active.id;
      INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id) VALUES(p_tenant_id,p_work_order_id,'work_paused',v_now,p_actor_id,p_actor_id);
      RETURN jsonb_build_object('status','paused');
    ELSE
      -- Completion closes every running session on this WO, including assisting technicians.
      UPDATE public.work_order_labor_sessions SET ended_at=v_now, duration_minutes=round(extract(epoch FROM (v_now-started_at))/60.0,2), labor_cost=CASE WHEN hourly_rate_snapshot IS NULL THEN NULL ELSE round(extract(epoch FROM (v_now-started_at))/3600.0*hourly_rate_snapshot,2) END, ended_reason='completed' WHERE tenant_id=p_tenant_id AND work_order_id=p_work_order_id AND ended_at IS NULL;
      IF NOT EXISTS (SELECT 1 FROM public.work_order_events WHERE work_order_id=p_work_order_id AND event_type='work_completed') THEN
        INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id) VALUES(p_tenant_id,p_work_order_id,'work_completed',v_now,p_actor_id,p_actor_id);
      END IF;
      RETURN jsonb_build_object('status','completed');
    END IF;
  ELSIF p_action='reopen' THEN
    INSERT INTO public.work_order_events(tenant_id,work_order_id,event_type,occurred_at,actor_user_id,staff_user_id)
      VALUES(p_tenant_id,p_work_order_id,'reopened',v_now,p_actor_id,p_actor_id);
    RETURN jsonb_build_object('status','reopened');
  END IF;
  RETURN jsonb_build_object('status','acknowledged');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_work_order_timing_action(UUID,UUID,UUID,TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_work_order_timing_action(UUID,UUID,UUID,TEXT) TO service_role;
