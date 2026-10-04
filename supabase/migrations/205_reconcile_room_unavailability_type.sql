-- Forward repair for the grandfathered duplicate 110_room_unavailability_type.sql, whose effects were proven
-- ABSENT in production. Identical canonical behavior, applied under a unique identifier: the generic OOO
-- room-status handoff with the Out of Order / Out of Service distinction kept on the episode. The historical 110
-- file is intentionally left untouched. Idempotent: CREATE OR REPLACE and re-asserted privileges.
CREATE OR REPLACE FUNCTION public.create_room_unavailability(
  p_room_id UUID, p_tenant_id UUID, p_type TEXT, p_reason_code TEXT, p_reason_label TEXT,
  p_details TEXT, p_expected_return_at TIMESTAMPTZ, p_owner_id UUID,
  p_work_order_id UUID, p_created_by UUID, p_source TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status room_status; v_period room_unavailability_periods; v_previous_status TEXT;
BEGIN
  IF p_type NOT IN ('OUT_OF_ORDER', 'OUT_OF_SERVICE') THEN RAISE EXCEPTION 'invalid room unavailability type'; END IF;
  SELECT * INTO v_status FROM room_status WHERE room_id = p_room_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  SELECT * INTO v_period FROM room_unavailability_periods WHERE room_id = p_room_id AND tenant_id = p_tenant_id AND status = 'ACTIVE' FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('period', to_jsonb(v_period), 'room_status', to_jsonb(v_status)); END IF;
  v_previous_status := v_status.status;
  INSERT INTO room_unavailability_periods (tenant_id, room_id, type, reason_code, reason_label, details, expected_return_at, owner_id, primary_work_order_id, created_by, source)
  VALUES (p_tenant_id, p_room_id, p_type, p_reason_code, p_reason_label, p_details, p_expected_return_at, p_owner_id, p_work_order_id, p_created_by, p_source)
  RETURNING * INTO v_period;
  UPDATE room_status SET status = 'OOO', notes = COALESCE(p_details, notes), updated_at = now() WHERE room_id = p_room_id AND tenant_id = p_tenant_id RETURNING * INTO v_status;
  INSERT INTO room_status_history (room_id, tenant_id, from_status, to_status, changed_by, change_source, notes)
  VALUES (p_room_id, p_tenant_id, v_previous_status, 'OOO', p_created_by, 'app', p_details);
  INSERT INTO room_unavailability_events (tenant_id, period_id, event_type, new_expected_return_at, note, actor_id)
  VALUES (p_tenant_id, v_period.id, 'CREATED', p_expected_return_at, p_details, p_created_by);
  RETURN jsonb_build_object('period', to_jsonb(v_period), 'room_status', to_jsonb(v_status));
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_room_unavailability(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_unavailability(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, TEXT) TO service_role;
