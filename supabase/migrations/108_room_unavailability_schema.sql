-- Hotel-wide room unavailability episodes. room_status remains the canonical
-- current-state record; these rows explain and audit an OOO interval.

CREATE TABLE IF NOT EXISTS public.room_unavailability_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  external_code TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.room_unavailability_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'OUT_OF_ORDER' CHECK (type IN ('OUT_OF_ORDER', 'OUT_OF_SERVICE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CANCELLED')),
  reason_code TEXT NOT NULL,
  reason_label TEXT NOT NULL,
  details TEXT,
  repair_remarks TEXT,
  primary_work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at TIMESTAMPTZ,
  actual_return_at TIMESTAMPTZ,
  return_status TEXT NOT NULL DEFAULT 'DIRTY' CHECK (return_status = 'DIRTY'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  released_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  release_notes TEXT,
  source TEXT NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB', 'MOBILE', 'PMS', 'API', 'AUTOMATION', 'LEGACY')),
  external_system TEXT,
  external_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_room_unavailability_per_room
  ON public.room_unavailability_periods (room_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_room_unavailability_tenant_active
  ON public.room_unavailability_periods (tenant_id, status, expected_return_at);

CREATE TABLE IF NOT EXISTS public.room_unavailability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.room_unavailability_periods(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'ETA_CHANGED', 'OWNER_CHANGED', 'WORK_ORDER_LINKED', 'RELEASED', 'CANCELLED')),
  old_expected_return_at TIMESTAMPTZ,
  new_expected_return_at TIMESTAMPTZ,
  note TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_unavailability_events_period ON public.room_unavailability_events (period_id, created_at);

ALTER TABLE public.room_unavailability_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_unavailability_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_unavailability_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_room_unavailability_reasons" ON public.room_unavailability_reasons FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_room_unavailability_periods" ON public.room_unavailability_periods FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_room_unavailability_events" ON public.room_unavailability_events FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE OR REPLACE FUNCTION public.create_room_unavailability(
  p_room_id UUID, p_tenant_id UUID, p_reason_code TEXT, p_reason_label TEXT,
  p_details TEXT, p_expected_return_at TIMESTAMPTZ, p_owner_id UUID,
  p_work_order_id UUID, p_created_by UUID, p_source TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status room_status; v_period room_unavailability_periods; v_previous_status TEXT;
BEGIN
  SELECT * INTO v_status FROM room_status WHERE room_id = p_room_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  IF v_status.status = 'OOO' THEN
    SELECT * INTO v_period FROM room_unavailability_periods WHERE room_id = p_room_id AND status = 'ACTIVE';
    IF FOUND THEN RETURN jsonb_build_object('period', to_jsonb(v_period), 'room_status', to_jsonb(v_status)); END IF;
  END IF;
  v_previous_status := v_status.status;
  INSERT INTO room_unavailability_periods (tenant_id, room_id, reason_code, reason_label, details, expected_return_at, owner_id, primary_work_order_id, created_by, source)
  VALUES (p_tenant_id, p_room_id, p_reason_code, p_reason_label, p_details, p_expected_return_at, p_owner_id, p_work_order_id, p_created_by, p_source)
  RETURNING * INTO v_period;
  UPDATE room_status SET status = 'OOO', notes = COALESCE(p_details, notes), updated_at = now() WHERE room_id = p_room_id AND tenant_id = p_tenant_id RETURNING * INTO v_status;
  INSERT INTO room_status_history (room_id, tenant_id, from_status, to_status, changed_by, change_source, notes)
  VALUES (p_room_id, p_tenant_id, v_previous_status, 'OOO', p_created_by, 'app', p_details);
  INSERT INTO room_unavailability_events (tenant_id, period_id, event_type, new_expected_return_at, note, actor_id)
  VALUES (p_tenant_id, v_period.id, 'CREATED', p_expected_return_at, p_details, p_created_by);
  RETURN jsonb_build_object('period', to_jsonb(v_period), 'room_status', to_jsonb(v_status));
END; $$;

CREATE OR REPLACE FUNCTION public.update_room_unavailability_eta(
  p_period_id UUID, p_tenant_id UUID, p_expected_return_at TIMESTAMPTZ, p_actor_id UUID, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period room_unavailability_periods; v_old TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_period FROM room_unavailability_periods WHERE id = p_period_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'ACTIVE' THEN RAISE EXCEPTION 'active out-of-order period not found'; END IF;
  v_old := v_period.expected_return_at;
  UPDATE room_unavailability_periods SET expected_return_at = p_expected_return_at, updated_at = now() WHERE id = p_period_id RETURNING * INTO v_period;
  INSERT INTO room_unavailability_events (tenant_id, period_id, event_type, old_expected_return_at, new_expected_return_at, note, actor_id)
  VALUES (p_tenant_id, p_period_id, 'ETA_CHANGED', v_old, p_expected_return_at, p_note, p_actor_id);
  RETURN to_jsonb(v_period);
END; $$;

CREATE OR REPLACE FUNCTION public.release_room_unavailability(
  p_period_id UUID, p_tenant_id UUID, p_released_by UUID, p_release_notes TEXT, p_source TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period room_unavailability_periods; v_status room_status; v_previous TEXT;
BEGIN
  SELECT * INTO v_period FROM room_unavailability_periods WHERE id = p_period_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'ACTIVE' THEN RAISE EXCEPTION 'active out-of-order period not found'; END IF;
  SELECT * INTO v_status FROM room_status WHERE room_id = v_period.room_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_status.status <> 'OOO' THEN RAISE EXCEPTION 'room status is not out of order'; END IF;
  v_previous := v_status.status;
  UPDATE room_unavailability_periods SET status = 'RELEASED', actual_return_at = now(), released_by = p_released_by, release_notes = p_release_notes, updated_at = now() WHERE id = p_period_id RETURNING * INTO v_period;
  UPDATE room_status SET status = 'DIRTY', notes = p_release_notes, updated_at = now() WHERE room_id = v_period.room_id AND tenant_id = p_tenant_id RETURNING * INTO v_status;
  INSERT INTO room_status_history (room_id, tenant_id, from_status, to_status, changed_by, change_source, notes)
  VALUES (v_period.room_id, p_tenant_id, v_previous, 'DIRTY', p_released_by, 'app', p_release_notes);
  INSERT INTO room_unavailability_events (tenant_id, period_id, event_type, note, actor_id)
  VALUES (p_tenant_id, p_period_id, 'RELEASED', p_release_notes, p_released_by);
  RETURN jsonb_build_object('period', to_jsonb(v_period), 'room_status', to_jsonb(v_status));
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_room_unavailability(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_room_unavailability_eta(UUID, UUID, TIMESTAMPTZ, UUID, TEXT) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_room_unavailability(UUID, UUID, UUID, TEXT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_unavailability(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_room_unavailability_eta(UUID, UUID, TIMESTAMPTZ, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_room_unavailability(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
