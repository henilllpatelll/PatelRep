-- =============================================================================
-- Migration 253: Agent Harness H5 -- gateway allowlist for the two Operations specialists and the human-approved
--                one-room Housekeeping assignment (ADR-0004)
-- =============================================================================
-- Additive only: CREATE OR REPLACE of agent__gateway_tool_spec (signature unchanged) and one new function.
--
-- (1) agent__gateway_tool_spec: the exact database allowlist of (agent, version, tool, version). The three H2 entries
--     for engineering.dispatch_assistant v1 are byte-for-byte unchanged. H5 adds exactly each specialist's manifest pins:
--       engineering.dispatch_assistant v2:        lookup v2, assignment_candidates v1 (read), assign v2 (write)
--       housekeeping.room_readiness_assistant v1: rooms.status_lookup v1, rooms.readiness_lookup v1,
--                                                 room_assignments.candidates v1 (reads), room_assignments.assign v1
--     No agent can reach another department's write: the key always includes the agent version.
--
-- (2) agent_tool_execute_room_assignment: THE approved Housekeeping write. One transaction with the same envelope as
--     agent_tool_execute_work_order_assign (fenced run lock -> idempotent replay -> controls / entitlement / initiator
--     authority / grant -> approval FOR UPDATE: state, consumption, expiry, exact binding, independence, approver's
--     CURRENT authority), then the canonical publish_assignment_batch (migrations 221/222) for ONE room with
--     operation_id = the invocation id, actor = the approving human, is_ai_suggested = true. A publication refusal
--     (SQLSTATE P0409 / P0422 / P0403) is caught in a sub-block (its partial work rolls back) and recorded as a
--     terminal failed ledger row with a stable code; the approval is consumed so a changed situation needs a new
--     review. publish_assignment_batch itself is NOT modified. Nothing here changes a room's status.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agent__gateway_tool_spec(
  p_agent_id text, p_agent_version integer, p_tool_id text, p_tool_version integer
)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_agent_id = 'engineering.dispatch_assistant' AND p_agent_version = 1 THEN
    CASE
      WHEN p_tool_id = 'engineering.work_orders.lookup' AND p_tool_version = 2 THEN
        '{"access": "read", "risk": "low", "resource_type": "work_order",
          "roles": ["chief_engineer", "engineer", "gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'housekeeping.rooms.status_lookup' AND p_tool_version = 1 THEN
        '{"access": "read", "risk": "low", "resource_type": "room",
          "roles": ["gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'engineering.work_orders.assign' AND p_tool_version = 2 THEN
        '{"access": "write", "risk": "medium", "resource_type": "work_order",
          "roles": ["chief_engineer", "gm"]}'::jsonb
    END
    WHEN p_agent_id = 'engineering.dispatch_assistant' AND p_agent_version = 2 THEN
    CASE
      WHEN p_tool_id = 'engineering.work_orders.lookup' AND p_tool_version = 2 THEN
        '{"access": "read", "risk": "low", "resource_type": "work_order",
          "roles": ["chief_engineer", "engineer", "gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'engineering.work_orders.assignment_candidates' AND p_tool_version = 1 THEN
        '{"access": "read", "risk": "low", "resource_type": "work_order",
          "roles": ["chief_engineer", "gm"]}'::jsonb
      WHEN p_tool_id = 'engineering.work_orders.assign' AND p_tool_version = 2 THEN
        '{"access": "write", "risk": "medium", "resource_type": "work_order",
          "roles": ["chief_engineer", "gm"]}'::jsonb
    END
    WHEN p_agent_id = 'housekeeping.room_readiness_assistant' AND p_agent_version = 1 THEN
    CASE
      WHEN p_tool_id = 'housekeeping.rooms.status_lookup' AND p_tool_version = 1 THEN
        '{"access": "read", "risk": "low", "resource_type": "room",
          "roles": ["gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'housekeeping.rooms.readiness_lookup' AND p_tool_version = 1 THEN
        '{"access": "read", "risk": "low", "resource_type": "room",
          "roles": ["gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'housekeeping.room_assignments.candidates' AND p_tool_version = 1 THEN
        '{"access": "read", "risk": "low", "resource_type": "room",
          "roles": ["gm", "housekeeping_supervisor"]}'::jsonb
      WHEN p_tool_id = 'housekeeping.room_assignments.assign' AND p_tool_version = 1 THEN
        '{"access": "write", "risk": "high", "resource_type": "room",
          "roles": ["gm", "housekeeping_supervisor"]}'::jsonb
    END
  END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_execute_room_assignment(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_action_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run      public.agent_runs%ROWTYPE;
  v_inv      public.agent_tool_invocations%ROWTYPE;
  v_appr     public.agent_tool_approvals%ROWTYPE;
  v_exec     public.agent_tool_executions%ROWTYPE;
  v_spec     jsonb;
  v_refusal  text;
  v_role     text;
  v_args     jsonb;
  v_assignee uuid;
  v_expected uuid;
  v_date     date;
  v_kind     text;
  v_domain   jsonb;
  v_room     jsonb;
  v_state    text;
  v_code     text;
  v_result   jsonb := '{}'::jsonb;
  v_msg      text;
  v_detail   text;
  v_conflict text;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations
   WHERE id = p_invocation_id AND run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND OR v_inv.tool_id <> 'housekeeping.room_assignments.assign' OR v_inv.tool_version <> 1
     OR v_inv.access <> 'write' OR v_inv.resource_type <> 'room' OR v_inv.action_digest IS DISTINCT FROM p_action_digest THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');
  END IF;

  -- Idempotency: a committed outcome for this key is returned as-is (no second side effect).
  SELECT * INTO v_exec FROM public.agent_tool_executions
   WHERE tenant_id = v_inv.tenant_id AND idempotency_key = v_inv.idempotency_key;
  IF FOUND THEN
    IF v_exec.action_digest IS DISTINCT FROM v_inv.action_digest OR v_exec.invocation_id <> v_inv.id THEN
      PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, NULL, v_exec.id, 'execution_refused',
                                       'worker', p_worker, 'idempotency_conflict', p_fencing_token, '{}'::jsonb);
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_exec.approval_id, v_exec.id,
                                     'execution_replayed', 'worker', p_worker, v_exec.state, p_fencing_token, '{}'::jsonb);
    RETURN jsonb_build_object('outcome', 'replayed', 'execution', public.agent__execution_json(v_exec));
  END IF;

  v_spec := public.agent__gateway_tool_spec(v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version);
  v_refusal := public.agent__gateway_refusal(v_inv.tenant_id, v_inv.agent_id, v_inv.agent_version, v_inv.tool_id,
                                             v_inv.tool_version, v_inv.initiated_by_user_id);
  IF v_refusal IS NULL THEN
    SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE invocation_id = v_inv.id FOR UPDATE;
    IF NOT FOUND THEN
      v_refusal := 'approval_missing';
    ELSIF v_appr.state <> 'approved' THEN
      v_refusal := 'approval_' || v_appr.state;
    ELSIF v_appr.consumed_at IS NOT NULL THEN
      v_refusal := 'approval_consumed';
    ELSIF v_appr.expires_at <= now() THEN
      v_refusal := 'approval_expired';
    ELSIF v_appr.action_digest IS DISTINCT FROM v_inv.action_digest OR v_appr.tenant_id <> v_inv.tenant_id
          OR v_appr.initiated_by_user_id <> v_inv.initiated_by_user_id
          OR (v_appr.agent_id, v_appr.agent_version, v_appr.tool_id, v_appr.tool_version)
             IS DISTINCT FROM (v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version)
          OR v_appr.resource_id IS DISTINCT FROM v_inv.resource_id THEN
      v_refusal := 'approval_binding_mismatch';
    ELSIF NOT v_appr.approver_may_be_initiator AND v_appr.decided_by_user_id = v_inv.initiated_by_user_id THEN
      v_refusal := 'self_approval_forbidden';
    ELSE
      v_role := public.agent__human_authority(
        v_inv.tenant_id, v_appr.decided_by_user_id,
        ARRAY(SELECT unnest(v_appr.required_approver_roles) INTERSECT SELECT unnest(public.agent__spec_roles(v_spec))));
      IF v_role IS NULL THEN
        v_refusal := 'approver_not_authorized';
      END IF;
    END IF;
  END IF;
  IF v_refusal IS NOT NULL THEN
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_appr.id, NULL, 'execution_refused',
                                     'worker', p_worker, v_refusal, p_fencing_token, '{}'::jsonb);
    RETURN jsonb_build_object('outcome', 'refused', 'reason', v_refusal);
  END IF;

  v_args := v_inv.arguments;
  IF (v_args->>'room_id') IS DISTINCT FROM v_inv.resource_id::text THEN
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_appr.id, NULL, 'execution_refused',
                                     'worker', p_worker, 'resource_mismatch', p_fencing_token, '{}'::jsonb);
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'resource_mismatch');
  END IF;
  v_assignee := (v_args->>'assignee_user_id')::uuid;
  v_expected := NULLIF(v_args->>'expected_assigned_to', '')::uuid;
  v_date := (v_args->>'assignment_date')::date;
  v_kind := CASE WHEN v_expected IS NULL THEN 'assign' ELSE 'reassign' END;

  IF v_assignee IS NOT DISTINCT FROM v_expected THEN
    v_state := 'failed';
    v_code := 'proposal_is_noop';
  ELSE
    -- The receiver's eligibility row is held FOR SHARE until commit, so a concurrent deactivation serialises behind
    -- this publication (publish_assignment_batch re-checks the same rule against these rows).
    PERFORM 1 FROM public.user_roles
     WHERE tenant_id = v_inv.tenant_id AND user_id = v_assignee AND is_active
       AND role IN ('housekeeper', 'housekeeping_supervisor')
     FOR SHARE;
    BEGIN
      v_domain := public.publish_assignment_batch(
        v_inv.tenant_id, v_appr.decided_by_user_id, v_inv.id, v_date,
        jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'room_id', v_inv.resource_id, 'kind', v_kind, 'housekeeper_id', v_assignee,
          'expected_assigned_to', v_expected,
          'expect_unassigned', CASE WHEN v_kind = 'assign' THEN true END,
          'is_ai_suggested', true))));
      v_room := v_domain->'rooms'->0;
      IF v_domain->>'status' = 'committed' AND v_room IS NOT NULL
         AND (v_room->>'room_id') = v_inv.resource_id::text AND (v_room->>'assigned_to') = v_assignee::text THEN
        v_state := 'succeeded';
        v_result := jsonb_build_object(
          'room_id', v_room->>'room_id', 'assigned_to', v_room->>'assigned_to',
          'previous_assigned_to', v_room->'previous_assigned_to', 'assignment_date', v_date::text,
          'kind', v_room->>'kind', 'changed', true);
      ELSE
        RAISE EXCEPTION 'unexpected publication result' USING ERRCODE = 'P0001';
      END IF;
    EXCEPTION WHEN SQLSTATE 'P0409' OR SQLSTATE 'P0422' OR SQLSTATE 'P0403' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      v_state := 'failed';
      v_result := '{}'::jsonb;
      BEGIN
        v_conflict := (v_detail::jsonb)->'conflicts'->0->>'code';
      EXCEPTION WHEN OTHERS THEN
        v_conflict := NULL;
      END;
      v_code := CASE
        WHEN v_msg = 'assignment_batch_conflict' THEN CASE v_conflict
          WHEN 'assignment_changed' THEN 'resource_changed'
          WHEN 'room_not_assignable' THEN 'room_not_assignable'
          WHEN 'room_blocked' THEN 'room_blocked'
          WHEN 'invalid_housekeeper' THEN 'assignee_not_eligible'
          WHEN 'room_not_found' THEN 'resource_not_found'
          ELSE 'resource_changed' END
        WHEN v_msg = 'date_mismatch' THEN 'date_not_hotel_today'
        WHEN v_msg = 'not_authorized' THEN 'approver_not_authorized'
        WHEN v_msg = 'operation_id_reused' THEN 'idempotency_conflict'
        ELSE 'domain_refused' END;
    END;
  END IF;

  INSERT INTO public.agent_tool_executions (tenant_id, run_id, invocation_id, tool_id, tool_version, action_digest,
                                            idempotency_key, approval_id, fencing_token, worker_id, state, error_class,
                                            error_code, result, result_resource_id)
  VALUES (v_inv.tenant_id, v_run.id, v_inv.id, v_inv.tool_id, v_inv.tool_version, v_inv.action_digest,
          v_inv.idempotency_key, v_appr.id, p_fencing_token, p_worker, v_state,
          CASE WHEN v_state = 'failed' THEN 'precondition_failed' END, v_code, v_result, v_inv.resource_id)
  RETURNING * INTO v_exec;
  UPDATE public.agent_tool_approvals SET consumed_at = now(), consumed_by_execution_id = v_exec.id WHERE id = v_appr.id;
  PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_appr.id, v_exec.id,
                                   CASE WHEN v_state = 'succeeded' THEN 'execution_succeeded' ELSE 'execution_failed' END,
                                   'worker', p_worker, COALESCE(v_code, v_kind), p_fencing_token,
                                   jsonb_build_object('approver_role', v_role));
  RETURN jsonb_build_object('outcome', v_state, 'execution', public.agent__execution_json(v_exec));
END;
$function$;

REVOKE ALL ON FUNCTION public.agent__gateway_tool_spec(text, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_execute_room_assignment(uuid, bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent__gateway_tool_spec(text, integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_execute_room_assignment(uuid, bigint, text, uuid, text) TO service_role;
