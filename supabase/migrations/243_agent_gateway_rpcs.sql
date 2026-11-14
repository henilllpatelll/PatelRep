-- =============================================================================
-- Migration 243: Agent Harness H2 -- Tool Gateway RPCs
-- =============================================================================
-- Additive: new functions over migrations 238 + 241, plus a reviewed redefinition of agent_run_claim whose ONLY change
-- is that a stray message for an 'awaiting_approval' run is dropped exactly like one for a 'paused' run.
-- Every function is SECURITY INVOKER with an empty search_path, revoked from PUBLIC/anon/authenticated and granted only
-- to service_role. Each public RPC is ONE transaction.
--
-- Authority model (defence in depth; the Python gateway evaluates the same rules with H0 policy.evaluate):
--   * agent__gateway_tool_spec   the exact DB allowlist of (agent, version, tool, version) -> access, risk, resource
--                                type, roles. Anything else is refused. A drift test pins it to the Python bindings.
--   * agent__human_authority     a person's CURRENT authority: active hotel, active profile in that hotel, exactly one
--                                active role there, and that role in the required set (rows locked FOR SHARE so a
--                                concurrent demotion serialises behind the decision).
--   * agent__gateway_refusal     controls (platform/hotel/agent pause, cost stop, platform enablement, tool pause),
--                                ai_agents entitlement, initiator authority and the per-property grant.
--
-- Human identity passed to these RPCs (p_actor_user_id) comes from a verified CurrentUser in the API process; the
-- database never accepts a role from the caller -- it re-reads it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__gateway_tool_spec(
  p_agent_id text, p_agent_version integer, p_tool_id text, p_tool_version integer
)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_agent_id = 'engineering.dispatch_assistant' AND p_agent_version = 1 THEN
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
  END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__spec_roles(p_spec jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_spec->'roles') ORDER BY 1), ARRAY[]::text[]);
$function$;

CREATE OR REPLACE FUNCTION public.agent__human_authority(p_tenant_id uuid, p_user_id uuid, p_roles text[])
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_roles text[];
BEGIN
  IF p_user_id IS NULL OR p_roles IS NULL OR cardinality(p_roles) = 0 THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND is_active) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id AND tenant_id = p_tenant_id AND is_active) THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(r.role) INTO v_roles
    FROM (SELECT role FROM public.user_roles
           WHERE user_id = p_user_id AND tenant_id = p_tenant_id AND is_active FOR SHARE) r;
  IF v_roles IS NULL OR cardinality(v_roles) <> 1 OR NOT (v_roles[1] = ANY (p_roles)) THEN
    RETURN NULL;  -- no membership, ambiguous membership, or a role without this authority
  END IF;
  RETURN v_roles[1];
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__tool_block_reason(p_tenant_id uuid, p_agent_id text, p_tool_id text)
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT COALESCE(
    public.agent__control_block_reason(p_tenant_id, p_agent_id),
    CASE
      WHEN NOT COALESCE((SELECT enabled FROM public.agent_execution_enablement WHERE id = 1), false)
        THEN 'platform_execution_disabled'
      WHEN EXISTS (SELECT 1 FROM public.agent_tool_controls WHERE tool_id = p_tool_id AND paused) THEN 'tool_paused'
    END);
$function$;

CREATE OR REPLACE FUNCTION public.agent__tool_grant_level(
  p_tenant_id uuid, p_agent_id text, p_agent_version integer, p_tool_id text, p_tool_version integer, p_risk text
)
RETURNS integer LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT COALESCE(max(g.max_level), 0)::integer
    FROM public.agent_tool_grants g
   WHERE g.tenant_id = p_tenant_id AND g.agent_id = p_agent_id AND g.agent_version = p_agent_version
     AND g.tool_id = p_tool_id AND g.tool_version = p_tool_version
     AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
     AND array_position(ARRAY['low', 'medium', 'high'], p_risk) <= array_position(ARRAY['low', 'medium', 'high'], g.max_risk);
$function$;

-- Why this (agent, tool) call must not proceed for this hotel and initiator right now (NULL = it may proceed).
CREATE OR REPLACE FUNCTION public.agent__gateway_refusal(
  p_tenant_id uuid, p_agent_id text, p_agent_version integer, p_tool_id text, p_tool_version integer, p_user_id uuid
)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_spec  jsonb := public.agent__gateway_tool_spec(p_agent_id, p_agent_version, p_tool_id, p_tool_version);
  v_block text;
  v_needed integer;
BEGIN
  IF v_spec IS NULL THEN
    RETURN 'tool_not_allowed';
  END IF;
  v_block := public.agent__tool_block_reason(p_tenant_id, p_agent_id, p_tool_id);
  IF v_block IS NOT NULL THEN
    RETURN v_block;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags
                  WHERE tenant_id = p_tenant_id AND feature_key = 'ai_agents' AND enabled) THEN
    RETURN 'tenant_capability_disabled';
  END IF;
  IF public.agent__human_authority(p_tenant_id, p_user_id, public.agent__spec_roles(v_spec)) IS NULL THEN
    RETURN 'actor_not_authorized';
  END IF;
  v_needed := CASE WHEN v_spec->>'access' = 'write' THEN 2 ELSE 1 END;  -- human_approved for writes, observe for reads
  IF public.agent__tool_grant_level(p_tenant_id, p_agent_id, p_agent_version, p_tool_id, p_tool_version,
                                    v_spec->>'risk') < v_needed THEN
    RETURN 'tool_not_granted';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__tool_event(
  p_tenant_id uuid, p_run_id uuid, p_invocation_id uuid, p_approval_id uuid, p_execution_id uuid, p_event_type text,
  p_actor_kind text, p_actor_ref text, p_reason_code text, p_fencing_token bigint, p_detail jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.agent_tool_events (tenant_id, run_id, invocation_id, approval_id, execution_id, event_type,
                                        actor_kind, actor_ref, reason_code, fencing_token, detail)
  VALUES (p_tenant_id, p_run_id, p_invocation_id, p_approval_id, p_execution_id, p_event_type, p_actor_kind,
          CASE WHEN p_actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_actor_ref END,
          CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END,
          p_fencing_token, COALESCE(p_detail, '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.agent__approval_json(p_approval public.agent_tool_approvals)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_approval.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_approval.id, 'tenant_id', p_approval.tenant_id, 'run_id', p_approval.run_id,
    'invocation_id', p_approval.invocation_id, 'agent_id', p_approval.agent_id,
    'agent_version', p_approval.agent_version, 'tool_id', p_approval.tool_id, 'tool_version', p_approval.tool_version,
    'resource_type', p_approval.resource_type, 'resource_id', p_approval.resource_id,
    'action_digest', p_approval.action_digest, 'initiated_by_user_id', p_approval.initiated_by_user_id,
    'approval_policy_id', p_approval.approval_policy_id,
    'approver_may_be_initiator', p_approval.approver_may_be_initiator,
    'required_approver_roles', to_jsonb(p_approval.required_approver_roles), 'state', p_approval.state,
    'decided_by_user_id', p_approval.decided_by_user_id, 'decided_role', p_approval.decided_role,
    'decided_at', p_approval.decided_at, 'decision_reason_code', p_approval.decision_reason_code,
    'ended_by', p_approval.ended_by, 'ended_at', p_approval.ended_at, 'expires_at', p_approval.expires_at,
    'consumed_at', p_approval.consumed_at, 'created_at', p_approval.created_at) END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__execution_json(p_execution public.agent_tool_executions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_execution.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_execution.id, 'invocation_id', p_execution.invocation_id, 'tool_id', p_execution.tool_id,
    'tool_version', p_execution.tool_version, 'action_digest', p_execution.action_digest,
    'idempotency_key', p_execution.idempotency_key, 'approval_id', p_execution.approval_id,
    'fencing_token', p_execution.fencing_token, 'state', p_execution.state, 'error_class', p_execution.error_class,
    'error_code', p_execution.error_code, 'result', p_execution.result,
    'result_resource_id', p_execution.result_resource_id, 'created_at', p_execution.created_at) END;
$function$;

-- End a waiting / not-yet-leased gateway run after its approval can no longer be used.
CREATE OR REPLACE FUNCTION public.agent__end_run_for_approval(p_run_id uuid, p_reason text, p_actor_kind text, p_actor_ref text)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_run.state = 'awaiting_approval'
     OR (v_run.state IN ('queued', 'retry_wait') AND (v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now())) THEN
    PERFORM public.agent__set_event_context(p_actor_kind, p_actor_ref, p_reason);
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'authorization_denied', p_reason, false);
    RETURN 'failed';
  END IF;
  RETURN v_run.state;  -- a live worker owns it; the fenced execute RPC refuses the unusable approval
END;
$function$;

-- -----------------------------------------------------------------------------
-- Authorization snapshot: the inputs the Python gateway feeds to H0 policy.evaluate (entitlements, grants, controls).
-- Read fresh for every admission and every step; never cached by the database.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_authorization_snapshot(p_tenant_id uuid, p_agent_id text, p_agent_version integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'enabled_flags', COALESCE((SELECT jsonb_agg(feature_key ORDER BY feature_key) FROM public.tenant_feature_flags
                                WHERE tenant_id = p_tenant_id AND enabled), '[]'::jsonb),
    'grants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'tool_id', g.tool_id, 'tool_version', g.tool_version, 'max_level', g.max_level,
                  'max_risk', g.max_risk, 'granted_by_user_id', g.granted_by_user_id, 'granted_at', g.granted_at,
                  'expires_at', g.expires_at) ORDER BY g.tool_id)
                FROM public.agent_tool_grants g
               WHERE g.tenant_id = p_tenant_id AND g.agent_id = p_agent_id AND g.agent_version = p_agent_version
                 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())), '[]'::jsonb),
    'platform_execution_enabled', COALESCE((SELECT enabled FROM public.agent_execution_enablement WHERE id = 1), false),
    'paused_tools', COALESCE((SELECT jsonb_agg(tool_id ORDER BY tool_id) FROM public.agent_tool_controls WHERE paused), '[]'::jsonb),
    'controls', COALESCE((SELECT jsonb_agg(jsonb_build_object('scope', scope, 'tenant_id', tenant_id, 'agent_id', agent_id,
                  'paused', paused, 'cost_emergency_stop', cost_emergency_stop))
                FROM public.agent_runtime_controls
               WHERE scope = 'platform' OR (scope = 'hotel' AND tenant_id = p_tenant_id)
                  OR (scope = 'agent' AND agent_id = p_agent_id)), '[]'::jsonb),
    'db_now', now());
$function$;

-- -----------------------------------------------------------------------------
-- Admission: a gateway run with exactly one tool invocation (step 1). Authority re-read in the database.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_run_admit(
  p_tenant_id         uuid,
  p_agent_id          text,
  p_agent_version     integer,
  p_user_id           uuid,
  p_idempotency_key   text,
  p_request_digest    text,
  p_correlation_id    text,
  p_policy_version    text,
  p_tool_id           text,
  p_tool_version      integer,
  p_arguments         jsonb,
  p_resource_type     text,
  p_resource_id       uuid,
  p_action_digest     text,
  p_deadline_seconds  integer,
  p_max_attempts      integer,
  p_step_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_spec    jsonb := public.agent__gateway_tool_spec(p_agent_id, p_agent_version, p_tool_id, p_tool_version);
  v_refusal text;
  v_result  jsonb;
  v_run_id  uuid;
  v_inv     public.agent_tool_invocations%ROWTYPE;
BEGIN
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'tool_not_allowed');
  END IF;
  IF p_resource_type IS DISTINCT FROM v_spec->>'resource_type' OR p_resource_id IS NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'resource_out_of_scope');
  END IF;
  IF (p_resource_type = 'work_order' AND NOT EXISTS (
        SELECT 1 FROM public.work_orders WHERE id = p_resource_id AND tenant_id = p_tenant_id))
     OR (p_resource_type = 'room' AND NOT EXISTS (
        SELECT 1 FROM public.rooms WHERE id = p_resource_id AND tenant_id = p_tenant_id)) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'resource_out_of_scope');
  END IF;
  v_refusal := public.agent__gateway_refusal(p_tenant_id, p_agent_id, p_agent_version, p_tool_id, p_tool_version, p_user_id);
  IF v_refusal IS NOT NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', v_refusal);
  END IF;

  PERFORM set_config('patelrep.agent_gateway_admission', 'on', true);
  v_result := public.agent_run_admit(
    p_tenant_id, p_agent_id, p_agent_version, 'human', p_user_id, NULL, 'user_request', p_idempotency_key,
    p_request_digest, p_correlation_id, p_policy_version, '{}'::jsonb, 'tool_invocation', p_deadline_seconds,
    p_max_attempts, p_step_max_attempts);
  PERFORM set_config('patelrep.agent_gateway_admission', '', true);

  IF NOT COALESCE((v_result->>'admitted')::boolean, false) THEN
    RETURN v_result;
  END IF;
  v_run_id := (v_result->>'run_id')::uuid;

  IF COALESCE((v_result->>'created')::boolean, false) THEN
    INSERT INTO public.agent_tool_invocations (
      tenant_id, run_id, step_number, agent_id, agent_version, tool_id, tool_version, access, arguments,
      resource_type, resource_id, action_digest, idempotency_key, initiated_by_user_id)
    VALUES (
      p_tenant_id, v_run_id, 1, p_agent_id, p_agent_version, p_tool_id, p_tool_version, v_spec->>'access',
      COALESCE(p_arguments, '{}'::jsonb), p_resource_type, p_resource_id, p_action_digest,
      'tool:' || v_run_id::text || ':1', p_user_id)
    RETURNING * INTO v_inv;
    PERFORM public.agent__tool_event(p_tenant_id, v_run_id, v_inv.id, NULL, NULL, 'invocation_admitted', 'admission',
                                     'user:' || p_user_id::text, NULL, NULL,
                                     jsonb_build_object('tool_id', p_tool_id, 'tool_version', p_tool_version));
  ELSE
    SELECT * INTO v_inv FROM public.agent_tool_invocations WHERE run_id = v_run_id AND step_number = 1;
    IF NOT FOUND OR v_inv.action_digest IS DISTINCT FROM p_action_digest THEN
      RETURN jsonb_build_object('admitted', false, 'reason', 'idempotency_conflict');
    END IF;
  END IF;
  RETURN v_result || jsonb_build_object('invocation_id', v_inv.id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: fenced step context (invocation + approval + execution + authorization snapshot inputs)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_step_context(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run   public.agent_runs%ROWTYPE;
  v_inv   public.agent_tool_invocations%ROWTYPE;
  v_appr  public.agent_tool_approvals%ROWTYPE;
  v_exec  public.agent_tool_executions%ROWTYPE;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations
   WHERE run_id = v_run.id AND tenant_id = v_run.tenant_id AND step_number = p_step_number;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invocation_missing');
  END IF;
  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE invocation_id = v_inv.id;
  SELECT * INTO v_exec FROM public.agent_tool_executions WHERE invocation_id = v_inv.id;
  RETURN jsonb_build_object(
    'ok', true,
    'invocation', jsonb_build_object(
      'id', v_inv.id, 'tenant_id', v_inv.tenant_id, 'run_id', v_inv.run_id, 'step_number', v_inv.step_number,
      'agent_id', v_inv.agent_id, 'agent_version', v_inv.agent_version, 'tool_id', v_inv.tool_id,
      'tool_version', v_inv.tool_version, 'access', v_inv.access, 'arguments', v_inv.arguments,
      'resource_type', v_inv.resource_type, 'resource_id', v_inv.resource_id, 'action_digest', v_inv.action_digest,
      'idempotency_key', v_inv.idempotency_key, 'initiated_by_user_id', v_inv.initiated_by_user_id),
    'approval', public.agent__approval_json(v_appr),
    'execution', public.agent__execution_json(v_exec),
    'snapshot', public.agent_tool_authorization_snapshot(v_run.tenant_id, v_run.agent_id, v_run.agent_version));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: request approval (idempotent) and release the run into 'awaiting_approval' atomically
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_request_approval(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_approval_policy_id text,
  p_approver_may_be_initiator boolean, p_ttl_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run   public.agent_runs%ROWTYPE;
  v_inv   public.agent_tool_invocations%ROWTYPE;
  v_appr  public.agent_tool_approvals%ROWTYPE;
  v_spec  jsonb;
  v_ttl   integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 3600), 60), 3600);
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations
   WHERE id = p_invocation_id AND run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND OR v_inv.access <> 'write' THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');
  END IF;
  v_spec := public.agent__gateway_tool_spec(v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version);
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');
  END IF;
  IF v_run.state = 'cancel_requested' THEN
    RETURN jsonb_build_object('outcome', 'cancel_pending');
  END IF;

  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE invocation_id = v_inv.id FOR UPDATE;
  IF FOUND THEN
    IF v_appr.state = 'approved' AND v_appr.consumed_at IS NULL AND v_appr.expires_at > now() THEN
      RETURN jsonb_build_object('outcome', 'approved', 'approval_id', v_appr.id);
    END IF;
    IF v_appr.state <> 'requested' OR v_appr.expires_at <= now() THEN
      RETURN jsonb_build_object('outcome', 'approval_unusable', 'approval_id', v_appr.id,
                                'state', v_appr.state, 'consumed', v_appr.consumed_at IS NOT NULL);
    END IF;
  ELSE
    INSERT INTO public.agent_tool_approvals (
      tenant_id, run_id, invocation_id, agent_id, agent_version, tool_id, tool_version, resource_type, resource_id,
      action_digest, initiated_by_user_id, approval_policy_id, approver_may_be_initiator, required_approver_roles,
      expires_at)
    VALUES (
      v_inv.tenant_id, v_run.id, v_inv.id, v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version,
      v_inv.resource_type, v_inv.resource_id, v_inv.action_digest, v_inv.initiated_by_user_id, p_approval_policy_id,
      COALESCE(p_approver_may_be_initiator, false), public.agent__spec_roles(v_spec), now() + make_interval(secs => v_ttl))
    RETURNING * INTO v_appr;
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_appr.id, NULL, 'approval_requested',
                                     'worker', p_worker, NULL, p_fencing_token,
                                     jsonb_build_object('expires_at', v_appr.expires_at));
  END IF;

  -- Release the run without consuming an attempt; it holds no lease and no queue message while it waits.
  PERFORM public.agent__set_event_context('worker', p_worker, 'awaiting_approval');
  UPDATE public.agent_run_steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         attempt_count = GREATEST(attempt_count - 1, 0)
   WHERE run_id = v_run.id AND state = 'running';
  PERFORM public.agent__drop_dispatch(v_run.id, v_run.queue_msg_id, false);
  UPDATE public.agent_runs SET state = 'awaiting_approval', lease_owner = NULL, lease_expires_at = NULL,
         lease_acquired_at = NULL, attempt_count = GREATEST(attempt_count - 1, 0)
   WHERE id = v_run.id;
  RETURN jsonb_build_object('outcome', 'awaiting_approval', 'approval_id', v_appr.id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Humans: approve / reject (current authority re-read here), revoke, read
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_approval_decide(
  p_tenant_id uuid, p_approval_id uuid, p_actor_user_id uuid, p_decision text, p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_appr  public.agent_tool_approvals%ROWTYPE;
  v_run   public.agent_runs%ROWTYPE;
  v_role  text;
  v_actor text := 'user:' || COALESCE(p_actor_user_id::text, 'unknown');
  v_reason text := CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE id = p_approval_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_appr.state <> 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'state', v_appr.state);
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = v_appr.run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_appr.expires_at <= now() OR v_run.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    UPDATE public.agent_tool_approvals
       SET state = CASE WHEN v_appr.expires_at <= now() THEN 'expired' ELSE 'revoked' END,
           ended_by = CASE WHEN v_appr.expires_at <= now() THEN 'recovery:expired' ELSE 'recovery:run_terminal' END,
           ended_at = now()
     WHERE id = v_appr.id RETURNING * INTO v_appr;
    PERFORM public.agent__tool_event(p_tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     CASE WHEN v_appr.state = 'expired' THEN 'approval_expired' ELSE 'approval_revoked' END,
                                     'recovery', 'agent_tool_approval_decide', v_appr.state, NULL, '{}'::jsonb);
    IF v_appr.state = 'expired' THEN
      PERFORM public.agent__end_run_for_approval(v_appr.run_id, 'approval_expired', 'recovery', 'agent_tool_approval_decide');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN v_appr.state = 'expired' THEN 'expired' ELSE 'run_terminal' END,
                              'state', v_appr.state);
  END IF;

  v_role := public.agent__human_authority(p_tenant_id, p_actor_user_id, v_appr.required_approver_roles);
  IF v_role IS NULL THEN
    PERFORM public.agent__tool_event(p_tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'policy_denied', 'human', v_actor, 'approver_not_authorized', NULL, '{}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'reason', 'approver_not_authorized');
  END IF;
  IF p_decision = 'approve' AND NOT v_appr.approver_may_be_initiator AND p_actor_user_id = v_appr.initiated_by_user_id THEN
    PERFORM public.agent__tool_event(p_tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'policy_denied', 'human', v_actor, 'self_approval_forbidden', NULL, '{}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'reason', 'self_approval_forbidden');
  END IF;

  UPDATE public.agent_tool_approvals
     SET state = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by_user_id = p_actor_user_id, decided_role = v_role, decided_at = now(), decision_reason_code = v_reason
   WHERE id = v_appr.id RETURNING * INTO v_appr;
  PERFORM public.agent__tool_event(p_tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                   CASE WHEN p_decision = 'approve' THEN 'approval_approved' ELSE 'approval_rejected' END,
                                   'human', v_actor, v_reason, NULL, jsonb_build_object('role', v_role));

  IF v_run.state = 'awaiting_approval' THEN
    IF p_decision = 'approve' THEN
      -- Exactly one resumption: the state flip happens once under the row lock, with one dispatch message.
      PERFORM public.agent__set_event_context('operator', v_actor, 'approval_granted');
      UPDATE public.agent_runs SET state = 'queued' WHERE id = v_run.id;
      PERFORM public.agent__dispatch(v_run.id, 0);
      PERFORM public.agent__tool_event(p_tenant_id, v_run.id, v_appr.invocation_id, v_appr.id, NULL, 'approval_resumed',
                                       'human', v_actor, NULL, NULL, '{}'::jsonb);
    ELSE
      PERFORM public.agent__set_event_context('operator', v_actor, 'approval_rejected');
      PERFORM public.agent__finish_run(v_run.id, 'failed', 'authorization_denied', 'approval_rejected', false);
    END IF;
  END IF;
  SELECT state INTO v_run.state FROM public.agent_runs WHERE id = v_run.id;
  RETURN jsonb_build_object('ok', true, 'state', v_appr.state, 'run_state', v_run.state, 'approval_id', v_appr.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_approval_revoke(
  p_tenant_id uuid, p_approval_id uuid, p_actor_user_id uuid, p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_appr  public.agent_tool_approvals%ROWTYPE;
  v_actor text := 'user:' || COALESCE(p_actor_user_id::text, 'unknown');
  v_run_state text;
BEGIN
  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE id = p_approval_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_appr.state NOT IN ('requested', 'approved') OR v_appr.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_revocable', 'state', v_appr.state,
                              'consumed', v_appr.consumed_at IS NOT NULL);
  END IF;
  -- The initiator (still a current member in any canonical role) may withdraw; otherwise approver authority is needed.
  IF NOT ((p_actor_user_id = v_appr.initiated_by_user_id AND public.agent__human_authority(
             p_tenant_id, p_actor_user_id,
             ARRAY['gm', 'housekeeping_supervisor', 'engineer', 'front_desk', 'housekeeper', 'chief_engineer']) IS NOT NULL)
          OR public.agent__human_authority(p_tenant_id, p_actor_user_id, v_appr.required_approver_roles) IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  UPDATE public.agent_tool_approvals SET state = 'revoked', ended_by = v_actor, ended_at = now(),
         decision_reason_code = COALESCE(CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END,
                                         decision_reason_code)
   WHERE id = v_appr.id RETURNING * INTO v_appr;
  PERFORM public.agent__tool_event(p_tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL, 'approval_revoked',
                                   'human', v_actor, p_reason_code, NULL, '{}'::jsonb);
  v_run_state := public.agent__end_run_for_approval(v_appr.run_id, 'approval_revoked', 'operator', v_actor);
  RETURN jsonb_build_object('ok', true, 'state', 'revoked', 'run_state', v_run_state);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_approval_get(p_tenant_id uuid, p_approval_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT public.agent__approval_json(a) FROM public.agent_tool_approvals a
   WHERE a.id = p_approval_id AND a.tenant_id = p_tenant_id;
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_approvals_list(p_tenant_id uuid, p_state text DEFAULT 'requested',
                                                            p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__approval_json(a) ORDER BY a.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_tool_approvals
           WHERE tenant_id = p_tenant_id AND (p_state IS NULL OR state = p_state)
           ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) a;
$function$;

-- -----------------------------------------------------------------------------
-- Sweep: expire approvals, close approvals of terminal runs, fail waiting runs past their deadline
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_approvals_expire(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_appr    public.agent_tool_approvals%ROWTYPE;
  v_run     public.agent_runs%ROWTYPE;
  v_expired integer := 0;
  v_closed  integer := 0;
  v_deadline integer := 0;
BEGIN
  FOR v_appr IN
    SELECT a.* FROM public.agent_tool_approvals a
     WHERE a.state IN ('requested', 'approved') AND a.consumed_at IS NULL AND a.expires_at <= now()
     ORDER BY a.expires_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.agent_tool_approvals SET state = 'expired', ended_by = 'recovery:expired', ended_at = now()
     WHERE id = v_appr.id;
    PERFORM public.agent__tool_event(v_appr.tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'approval_expired', 'recovery', 'agent_tool_approvals_expire', 'expired', NULL, '{}'::jsonb);
    PERFORM public.agent__end_run_for_approval(v_appr.run_id, 'approval_expired', 'recovery', 'agent_tool_approvals_expire');
    v_expired := v_expired + 1;
  END LOOP;

  FOR v_appr IN
    SELECT a.* FROM public.agent_tool_approvals a JOIN public.agent_runs r ON r.id = a.run_id AND r.tenant_id = a.tenant_id
     WHERE a.state IN ('requested', 'approved') AND a.consumed_at IS NULL
       AND r.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter')
     ORDER BY a.created_at LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
  LOOP
    UPDATE public.agent_tool_approvals SET state = 'revoked', ended_by = 'recovery:run_terminal', ended_at = now()
     WHERE id = v_appr.id;
    PERFORM public.agent__tool_event(v_appr.tenant_id, v_appr.run_id, v_appr.invocation_id, v_appr.id, NULL,
                                     'approval_revoked', 'recovery', 'agent_tool_approvals_expire', 'run_terminal', NULL, '{}'::jsonb);
    v_closed := v_closed + 1;
  END LOOP;

  FOR v_run IN
    SELECT * FROM public.agent_runs WHERE state = 'awaiting_approval' AND deadline_at <= now()
     ORDER BY deadline_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_tool_approvals_expire', 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    v_deadline := v_deadline + 1;
  END LOOP;

  RETURN jsonb_build_object('approvals_expired', v_expired, 'approvals_closed', v_closed, 'deadline_failed', v_deadline);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: record a read result / a failure (fenced; results go to the ledger, never to events)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_record_outcome(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_state text,
  p_result jsonb DEFAULT '{}'::jsonb, p_error_class text DEFAULT NULL, p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_inv  public.agent_tool_invocations%ROWTYPE;
  v_exec public.agent_tool_executions%ROWTYPE;
BEGIN
  IF p_state NOT IN ('succeeded', 'failed', 'attempt_failed') THEN
    RAISE EXCEPTION 'invalid outcome state' USING ERRCODE = '22023';
  END IF;
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations
   WHERE id = p_invocation_id AND run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');
  END IF;

  -- A committed outcome is replayed (and the redelivery audited) whatever the caller asks to record.
  SELECT * INTO v_exec FROM public.agent_tool_executions WHERE invocation_id = v_inv.id;
  IF FOUND THEN
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_exec.approval_id, v_exec.id,
                                     'execution_replayed', 'worker', p_worker, v_exec.state, p_fencing_token, '{}'::jsonb);
    RETURN jsonb_build_object('outcome', 'replayed', 'execution', public.agent__execution_json(v_exec));
  END IF;
  IF p_state = 'succeeded' AND v_inv.access <> 'read' THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');  -- writes record success only inside their own RPC
  END IF;

  IF p_state = 'attempt_failed' THEN
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, NULL, NULL, 'attempt_failed', 'worker',
                                     p_worker, p_error_code, p_fencing_token,
                                     jsonb_build_object('error_class', p_error_class));
    RETURN jsonb_build_object('outcome', 'attempt_recorded');
  END IF;

  INSERT INTO public.agent_tool_executions (tenant_id, run_id, invocation_id, tool_id, tool_version, action_digest,
                                            idempotency_key, fencing_token, worker_id, state, error_class, error_code,
                                            result, result_resource_id)
  VALUES (v_run.tenant_id, v_run.id, v_inv.id, v_inv.tool_id, v_inv.tool_version, v_inv.action_digest,
          v_inv.idempotency_key, p_fencing_token, p_worker, p_state,
          CASE WHEN p_state = 'failed' THEN p_error_class END, CASE WHEN p_state = 'failed' THEN p_error_code END,
          CASE WHEN p_state = 'succeeded' THEN COALESCE(p_result, '{}'::jsonb) ELSE '{}'::jsonb END, v_inv.resource_id)
  RETURNING * INTO v_exec;
  PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, NULL, v_exec.id,
                                   CASE WHEN p_state = 'succeeded' THEN 'read_succeeded' ELSE 'execution_failed' END,
                                   'worker', p_worker, p_error_code, p_fencing_token, '{}'::jsonb);
  RETURN jsonb_build_object('outcome', 'recorded', 'execution', public.agent__execution_json(v_exec));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: THE approved write. One transaction: fencing, controls, current authority (initiator AND approver), grant,
-- approval consumption, idempotency claim, domain mutation (shared work_order_assign_apply + its audit row), ledger
-- outcome and tool events. If any statement fails the whole transaction rolls back and nothing is consumed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_execute_work_order_assign(
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
  v_domain   jsonb;
  v_outcome  text;
  v_state    text;
  v_code     text;
  v_result   jsonb;
  v_args     jsonb;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations
   WHERE id = p_invocation_id AND run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND OR v_inv.tool_id <> 'engineering.work_orders.assign' OR v_inv.tool_version <> 2
     OR v_inv.access <> 'write' OR v_inv.action_digest IS DISTINCT FROM p_action_digest THEN
    RETURN jsonb_build_object('outcome', 'invocation_invalid');
  END IF;

  -- Idempotency: a committed outcome for this key is returned as-is (no second side effect). Serialised by the run
  -- row lock taken in agent__owned_run, and by the unique (tenant_id, idempotency_key) index below.
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
  IF (v_args->>'work_order_id') IS DISTINCT FROM v_inv.resource_id::text THEN
    PERFORM public.agent__tool_event(v_run.tenant_id, v_run.id, v_inv.id, v_appr.id, NULL, 'execution_refused',
                                     'worker', p_worker, 'resource_mismatch', p_fencing_token, '{}'::jsonb);
    RETURN jsonb_build_object('outcome', 'refused', 'reason', 'resource_mismatch');
  END IF;

  v_domain := public.work_order_assign_apply(
    v_inv.tenant_id, v_inv.resource_id, (v_args->>'assignee_user_id')::uuid,
    NULLIF(v_args->>'expected_assigned_to', '')::uuid, v_appr.decided_by_user_id, v_role,
    v_args->>'note', 'agent_harness_approved', 'automation');
  v_outcome := v_domain->>'outcome';
  IF v_outcome IN ('assigned', 'reassigned', 'unchanged') THEN
    v_state := 'succeeded';
    v_result := jsonb_build_object(
      'id', v_domain->'work_order'->>'id', 'assigned_to', v_domain->'work_order'->>'assigned_to',
      'status', v_domain->'work_order'->>'status', 'changed', v_outcome <> 'unchanged');
  ELSE
    v_state := 'failed';
    v_code := CASE v_outcome WHEN 'not_found' THEN 'resource_not_found' WHEN 'closed' THEN 'resource_closed'
                             WHEN 'assignee_not_eligible' THEN 'assignee_not_eligible' WHEN 'stale' THEN 'resource_changed'
                             ELSE 'domain_refused' END;
    v_result := '{}'::jsonb;
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
                                   'worker', p_worker, COALESCE(v_code, v_outcome), p_fencing_token,
                                   jsonb_build_object('approver_role', v_role));
  RETURN jsonb_build_object('outcome', v_state, 'execution', public.agent__execution_json(v_exec),
                            'previous_assigned_to', v_domain->'previous_assigned_to');
END;
$function$;

-- -----------------------------------------------------------------------------
-- Grants and controls
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_tool_grant_set(
  p_tenant_id uuid, p_actor_user_id uuid, p_agent_id text, p_agent_version integer, p_tool_id text,
  p_tool_version integer, p_max_level integer, p_expires_at timestamptz DEFAULT NULL, p_revoke boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_spec jsonb := public.agent__gateway_tool_spec(p_agent_id, p_agent_version, p_tool_id, p_tool_version);
  v_row  public.agent_tool_grants%ROWTYPE;
BEGIN
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tool_not_allowed');
  END IF;
  IF public.agent__human_authority(p_tenant_id, p_actor_user_id, ARRAY['gm']) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  IF COALESCE(p_revoke, false) THEN
    UPDATE public.agent_tool_grants SET revoked_at = now(), revoked_by_user_id = p_actor_user_id
     WHERE tenant_id = p_tenant_id AND agent_id = p_agent_id AND agent_version = p_agent_version
       AND tool_id = p_tool_id AND tool_version = p_tool_version AND revoked_at IS NULL
    RETURNING * INTO v_row;
    RETURN jsonb_build_object('ok', true, 'revoked', v_row.id IS NOT NULL);
  END IF;
  IF p_max_level NOT IN (1, 2) OR (p_max_level = 2 AND v_spec->>'access' <> 'write') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_level');
  END IF;
  INSERT INTO public.agent_tool_grants (tenant_id, agent_id, agent_version, tool_id, tool_version, max_level, max_risk,
                                        granted_by_user_id, expires_at)
  VALUES (p_tenant_id, p_agent_id, p_agent_version, p_tool_id, p_tool_version, p_max_level, v_spec->>'risk',
          p_actor_user_id, p_expires_at)
  ON CONFLICT (tenant_id, agent_id, agent_version, tool_id, tool_version) DO UPDATE SET
    max_level = EXCLUDED.max_level, max_risk = EXCLUDED.max_risk, granted_by_user_id = EXCLUDED.granted_by_user_id,
    granted_at = now(), expires_at = EXCLUDED.expires_at, revoked_at = NULL, revoked_by_user_id = NULL
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'grant_id', v_row.id, 'max_level', v_row.max_level, 'max_risk', v_row.max_risk);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_control_set(p_tool_id text, p_paused boolean, p_updated_by text,
                                                         p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
  INSERT INTO public.agent_tool_controls (tool_id, paused, reason_code, updated_by)
  VALUES (p_tool_id, COALESCE(p_paused, false), p_reason_code, p_updated_by)
  ON CONFLICT (tool_id) DO UPDATE SET paused = EXCLUDED.paused, reason_code = EXCLUDED.reason_code,
    updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING to_jsonb(agent_tool_controls.*);
$function$;

CREATE OR REPLACE FUNCTION public.agent_execution_enablement_set(p_enabled boolean, p_updated_by text,
                                                                 p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
  UPDATE public.agent_execution_enablement
     SET enabled = COALESCE(p_enabled, false), updated_by = p_updated_by, reason_code = p_reason_code, updated_at = now()
   WHERE id = 1
  RETURNING to_jsonb(agent_execution_enablement.*);
$function$;

CREATE OR REPLACE FUNCTION public.agent_tool_events_page(p_tenant_id uuid, p_run_id uuid, p_after_id bigint DEFAULT 0,
                                                         p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'invocation_id', e.invocation_id, 'approval_id', e.approval_id, 'execution_id', e.execution_id,
           'event_type', e.event_type, 'actor_kind', e.actor_kind, 'actor_ref', e.actor_ref,
           'reason_code', e.reason_code, 'fencing_token', e.fencing_token, 'detail', e.detail,
           'created_at', e.created_at) ORDER BY e.id), '[]'::jsonb)
  FROM (SELECT * FROM public.agent_tool_events
         WHERE tenant_id = p_tenant_id AND run_id = p_run_id AND id > COALESCE(p_after_id, 0)
         ORDER BY id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) e;
$function$;

-- -----------------------------------------------------------------------------
-- agent_run_claim (redefined). Identical to migration 239 except the 'paused' branch now also covers
-- 'awaiting_approval': such a run holds no dispatch, so any message naming it is dropped (resumption sends a fresh
-- one). Without this a forged/stray message would hit the state guard and roll the claim back on every read.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_run_claim(
  p_worker          text,
  p_lease_seconds   integer DEFAULT 60,
  p_vt_margin       integer DEFAULT 15,
  p_poison_read_ct  integer DEFAULT 10,
  p_blocked_retry   integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_lease   integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 900);
  v_margin  integer := LEAST(GREATEST(COALESCE(p_vt_margin, 15), 1), 300);
  v_msg     record;
  v_run_id  uuid;
  v_run     public.agent_runs%ROWTYPE;
  v_step    public.agent_run_steps%ROWTYPE;
  v_block   text;
  v_token   bigint;
  v_takeover boolean;
  v_wait    integer;
  v_valid   boolean;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9._:-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid worker id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_msg FROM pgmq.read('patelrep_agent_runs_v1', v_lease + v_margin, 1) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'empty');
  END IF;

  -- Closed envelope schema v1: exactly {"v": 1, "run_id": "<uuid>"}. Evaluated step by step (no reliance on OR order).
  v_valid := jsonb_typeof(v_msg.message) = 'object';
  IF v_valid THEN
    v_valid := COALESCE(v_msg.message->>'v' = '1', false)
           AND COALESCE((v_msg.message->>'run_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
  END IF;
  IF v_valid THEN
    v_valid := (SELECT count(*) FROM jsonb_object_keys(v_msg.message)) = 2;
  END IF;
  IF NOT v_valid THEN
    PERFORM pgmq.archive('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'poison', 'reason', 'malformed_envelope', 'msg_id', v_msg.msg_id);
  END IF;
  v_run_id := (v_msg.message->>'run_id')::uuid;

  SELECT * INTO v_run FROM public.agent_runs WHERE id = v_run_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM pgmq.archive('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'poison', 'reason', 'unknown_run', 'msg_id', v_msg.msg_id);
  END IF;

  IF v_run.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    PERFORM pgmq.delete('patelrep_agent_runs_v1', v_msg.msg_id);
    RETURN jsonb_build_object('outcome', 'stale_message', 'run_id', v_run.id, 'state', v_run.state);
  END IF;

  PERFORM public.agent__set_event_context('worker', p_worker, NULL);

  IF v_run.queue_msg_id IS NULL THEN
    -- The authoritative message went missing and this one names the run: adopt it rather than enqueue another.
    UPDATE public.agent_runs SET queue_msg_id = v_msg.msg_id WHERE id = v_run.id;
    v_run.queue_msg_id := v_msg.msg_id;
  ELSIF v_run.queue_msg_id <> v_msg.msg_id THEN
    PERFORM pgmq.delete('patelrep_agent_runs_v1', v_msg.msg_id);
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'duplicate_delivery', 'worker', p_worker, 'duplicate_message',
            jsonb_build_object('msg_id', v_msg.msg_id, 'authoritative_msg_id', v_run.queue_msg_id));
    RETURN jsonb_build_object('outcome', 'duplicate', 'run_id', v_run.id);
  END IF;

  IF v_msg.read_ct > GREATEST(COALESCE(p_poison_read_ct, 10), 2)
     AND NOT (v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now()) THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'poison_message', 'worker', p_worker, 'redelivery_limit',
            jsonb_build_object('msg_id', v_msg.msg_id, 'read_ct', v_msg.read_ct));
    PERFORM public.agent__set_event_context('worker', p_worker, 'redelivery_limit');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'poison_message', 'redelivery_limit', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'redelivery_limit');
  END IF;

  IF v_run.state IN ('paused', 'awaiting_approval') THEN
    -- A paused or approval-waiting run holds no dispatch; resume / approval sends a fresh one.
    PERFORM public.agent__drop_dispatch(v_run.id, v_msg.msg_id, false);
    RETURN jsonb_build_object('outcome', v_run.state, 'run_id', v_run.id);
  END IF;

  IF v_run.lease_expires_at IS NOT NULL AND v_run.lease_expires_at > now() THEN
    v_wait := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_run.lease_expires_at - now())))::integer, 0) + v_margin;
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, v_wait);
    RETURN jsonb_build_object('outcome', 'busy', 'run_id', v_run.id);
  END IF;

  IF v_run.state = 'cancel_requested' THEN
    -- The owning worker's lease expired before it acknowledged: the cancellation completes here.
    PERFORM public.agent__set_event_context('worker', p_worker, 'cancelled_after_lease_expiry');
    PERFORM public.agent__finish_run(v_run.id, 'cancelled', NULL, 'cancelled', false);
    RETURN jsonb_build_object('outcome', 'cancelled', 'run_id', v_run.id);
  END IF;

  IF v_run.deadline_at <= now() THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    RETURN jsonb_build_object('outcome', 'deadline_exceeded', 'run_id', v_run.id);
  END IF;

  IF v_run.state = 'retry_wait' AND v_run.next_attempt_at > now() THEN
    v_wait := GREATEST(CEIL(EXTRACT(EPOCH FROM (v_run.next_attempt_at - now())))::integer, 1);
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, v_wait);
    RETURN jsonb_build_object('outcome', 'not_due', 'run_id', v_run.id);
  END IF;

  v_block := public.agent__control_block_reason(v_run.tenant_id, v_run.agent_id);
  IF v_block IS NOT NULL THEN
    PERFORM public.agent__redispatch(v_run.id, v_msg.msg_id, LEAST(GREATEST(COALESCE(p_blocked_retry, 30), 1), 3600));
    IF v_run.state = 'running' THEN  -- expired lease of a crashed worker: hand the run back to the queue
      PERFORM public.agent__set_event_context('worker', p_worker, v_block);
      UPDATE public.agent_run_steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL
       WHERE run_id = v_run.id AND state = 'running';
      UPDATE public.agent_runs SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL
       WHERE id = v_run.id;
    END IF;
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
    VALUES (v_run.tenant_id, v_run.id, 'control_blocked', 'worker', p_worker, v_block);
    RETURN jsonb_build_object('outcome', 'blocked', 'run_id', v_run.id, 'reason', v_block);
  END IF;

  IF v_run.attempt_count >= v_run.max_attempts THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'attempts_exhausted');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'attempts_exhausted', 'attempts_exhausted', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'attempts_exhausted');
  END IF;

  SELECT * INTO v_step FROM public.agent_run_steps
   WHERE run_id = v_run.id AND state <> 'succeeded' ORDER BY step_number LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_step.state NOT IN ('pending', 'running', 'retry_wait') THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'inconsistent_run');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'invalid_job', 'inconsistent_run', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'inconsistent_run');
  END IF;
  IF v_step.attempt_count >= v_step.max_attempts THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'step_attempts_exhausted');
    PERFORM public.agent__finish_run(v_run.id, 'dead_letter', 'attempts_exhausted', 'step_attempts_exhausted', true);
    RETURN jsonb_build_object('outcome', 'dead_letter', 'run_id', v_run.id, 'reason', 'step_attempts_exhausted');
  END IF;

  v_takeover := v_run.state = 'running';
  v_token := v_run.fencing_token + 1;
  PERFORM public.agent__set_event_context('worker', p_worker, CASE WHEN v_takeover THEN 'lease_takeover' ELSE 'claimed' END);

  UPDATE public.agent_runs
     SET state = 'running', fencing_token = v_token, lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => v_lease), lease_acquired_at = now(), last_heartbeat_at = now(),
         attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), next_attempt_at = NULL,
         current_step_number = v_step.step_number
   WHERE id = v_run.id
  RETURNING * INTO v_run;
  UPDATE public.agent_run_steps
     SET state = 'running', attempt_count = attempt_count + 1, lease_owner = p_worker,
         lease_expires_at = v_run.lease_expires_at, fencing_token = v_token, started_at = COALESCE(started_at, now()),
         next_attempt_at = NULL
   WHERE id = v_step.id
  RETURNING * INTO v_step;
  INSERT INTO public.agent_run_events (tenant_id, run_id, step_id, event_type, attempt, fencing_token, actor_kind, actor_ref, detail)
  VALUES (v_run.tenant_id, v_run.id, v_step.id, CASE WHEN v_takeover THEN 'lease_takeover' ELSE 'claimed' END,
          v_run.attempt_count, v_token, 'worker', p_worker, jsonb_build_object('msg_id', v_msg.msg_id, 'read_ct', v_msg.read_ct));

  RETURN jsonb_build_object('outcome', 'claimed', 'takeover', v_takeover, 'fencing_token', v_token,
                            'lease_expires_at', v_run.lease_expires_at, 'msg_id', v_msg.msg_id,
                            'run', public.agent__run_json(v_run), 'step', public.agent__step_json(v_step));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Privileges: service role only
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__gateway_tool_spec(text, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__spec_roles(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__human_authority(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__tool_block_reason(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__tool_grant_level(uuid, text, integer, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__gateway_refusal(uuid, text, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__tool_event(uuid, uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__approval_json(public.agent_tool_approvals) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__execution_json(public.agent_tool_executions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__end_run_for_approval(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_authorization_snapshot(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_run_admit(uuid, text, integer, uuid, text, text, text, text, text, integer, jsonb, text, uuid, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_step_context(uuid, bigint, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_request_approval(uuid, bigint, text, uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_approval_decide(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_approval_revoke(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_approval_get(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_approvals_list(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_approvals_expire(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_record_outcome(uuid, bigint, text, uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_execute_work_order_assign(uuid, bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_grant_set(uuid, uuid, text, integer, text, integer, integer, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_control_set(text, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_execution_enablement_set(boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_tool_events_page(uuid, uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_claim(text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent__gateway_tool_spec(text, integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__spec_roles(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__human_authority(uuid, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__tool_block_reason(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__tool_grant_level(uuid, text, integer, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__gateway_refusal(uuid, text, integer, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__tool_event(uuid, uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__approval_json(public.agent_tool_approvals) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__execution_json(public.agent_tool_executions) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__end_run_for_approval(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_authorization_snapshot(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_run_admit(uuid, text, integer, uuid, text, text, text, text, text, integer, jsonb, text, uuid, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_step_context(uuid, bigint, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_request_approval(uuid, bigint, text, uuid, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_approval_decide(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_approval_revoke(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_approval_get(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_approvals_list(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_approvals_expire(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_record_outcome(uuid, bigint, text, uuid, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_execute_work_order_assign(uuid, bigint, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_grant_set(uuid, uuid, text, integer, text, integer, integer, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_control_set(text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_execution_enablement_set(boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_tool_events_page(uuid, uuid, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_claim(text, integer, integer, integer, integer) TO service_role;
