-- =============================================================================
-- Migration 252: Agent Harness H5 -- specialist planning intents, planning audit events and the H3 -> H2 proposal
--                handoff (ADR-0004)
-- =============================================================================
-- Additive only: two new tables, new functions, and CREATE OR REPLACE of three H3 functions with UNCHANGED signatures
-- (agent__planning_intent_roles, agent_planning_run_admit, agent_planning_record_plan). Every function is SECURITY
-- INVOKER with an empty search_path, revoked from PUBLIC/anon/authenticated and granted only to service_role.
--
-- The handoff is the ONLY path from a recorded plan to the Tool Gateway. agent_proposal_handoff_admit re-checks, in one
-- transaction under a lock on the planning row: the verified initiator, the plan outcome, the immutable plan digest,
-- the proposal TTL, the intent's single allowed write, the exact proposal (agent version, tool version, arguments,
-- resource) and the server-derived idempotency key, then calls agent_tool_run_admit (which re-checks the gateway
-- allowlist, resource ownership, controls, entitlement, the initiator's CURRENT authority and the per-property grant)
-- and records an immutable handoff row. A validated plan never executes by itself; nothing here approves anything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Intent catalog (mirrors services/agent_orchestrator/intents.py + orchestrator.py; drift tests pin both)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__planning_intent_roles(p_intent text, p_intent_version integer)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_intent = 'engineering.work_order_dispatch_plan' AND p_intent_version = 1 THEN ARRAY['chief_engineer', 'gm']
    WHEN p_intent = 'engineering.work_order_triage' AND p_intent_version = 1 THEN ARRAY['chief_engineer', 'engineer', 'gm']
    WHEN p_intent = 'engineering.work_order_dispatch_recommendation' AND p_intent_version = 1 THEN ARRAY['chief_engineer', 'gm']
    WHEN p_intent = 'housekeeping.room_readiness_review' AND p_intent_version = 1 THEN ARRAY['gm', 'housekeeping_supervisor']
    WHEN p_intent = 'housekeeping.room_assignment_recommendation' AND p_intent_version = 1 THEN ARRAY['gm', 'housekeeping_supervisor']
  END;
$function$;

-- resource_type, the specialist agent version whose grants the context reads use, and the ONE write it may propose.
CREATE OR REPLACE FUNCTION public.agent__planning_intent_spec(p_intent text, p_intent_version integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_intent = 'engineering.work_order_dispatch_plan' AND p_intent_version = 1 THEN
      '{"resource_type": "work_order", "specialist": null, "write": null}'::jsonb
    WHEN p_intent = 'engineering.work_order_triage' AND p_intent_version = 1 THEN
      '{"resource_type": "work_order", "specialist": {"agent_id": "engineering.dispatch_assistant", "agent_version": 2},
        "write": null}'::jsonb
    WHEN p_intent = 'engineering.work_order_dispatch_recommendation' AND p_intent_version = 1 THEN
      '{"resource_type": "work_order", "specialist": {"agent_id": "engineering.dispatch_assistant", "agent_version": 2},
        "write": {"tool_id": "engineering.work_orders.assign", "tool_version": 2}}'::jsonb
    WHEN p_intent = 'housekeeping.room_readiness_review' AND p_intent_version = 1 THEN
      '{"resource_type": "room", "specialist": {"agent_id": "housekeeping.room_readiness_assistant", "agent_version": 1},
        "write": null}'::jsonb
    WHEN p_intent = 'housekeeping.room_assignment_recommendation' AND p_intent_version = 1 THEN
      '{"resource_type": "room", "specialist": {"agent_id": "housekeeping.room_readiness_assistant", "agent_version": 1},
        "write": {"tool_id": "housekeeping.room_assignments.assign", "tool_version": 1}}'::jsonb
  END;
$function$;

-- -----------------------------------------------------------------------------
-- Planning audit events (append-only; identifiers, outcomes and reason codes only -- never prompts, facts or plans)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_planning_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  run_id       uuid        NOT NULL,
  handoff_id   uuid,
  event_type   text        NOT NULL CHECK (event_type IN (
                 'specialist_selected', 'context_gathered', 'plan_proposed', 'plan_recommended', 'plan_refused',
                 'plan_escalated', 'plan_rejected', 'recommendation_dismissed', 'handoff_submitted', 'handoff_replayed',
                 'handoff_refused', 'handoff_cancelled')),
  actor_kind   text        NOT NULL CHECK (actor_kind IN ('worker', 'human')),
  actor_ref    text        CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  reason_code  text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_planning_events_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_planning_events_run_idx ON public.agent_planning_events (tenant_id, run_id, id);

DROP TRIGGER IF EXISTS agent_planning_events_immutable ON public.agent_planning_events;
CREATE TRIGGER agent_planning_events_immutable BEFORE UPDATE OR DELETE ON public.agent_planning_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();

CREATE OR REPLACE FUNCTION public.agent__planning_event(
  p_tenant_id uuid, p_run_id uuid, p_handoff_id uuid, p_event_type text, p_actor_kind text, p_actor_ref text,
  p_reason_code text, p_detail jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.agent_planning_events (tenant_id, run_id, handoff_id, event_type, actor_kind, actor_ref,
                                            reason_code, detail)
  VALUES (p_tenant_id, p_run_id, p_handoff_id, p_event_type, p_actor_kind,
          CASE WHEN p_actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_actor_ref END,
          CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END,
          COALESCE(p_detail, '{}'::jsonb));
$function$;

-- -----------------------------------------------------------------------------
-- Proposal handoffs (immutable): one row binds ONE validated proposal to ONE gateway invocation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_proposal_handoffs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  planning_run_id       uuid        NOT NULL,
  plan_digest           text        NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  step_number           integer     NOT NULL CHECK (step_number BETWEEN 1 AND 4),
  intent                text        NOT NULL CHECK (intent ~ '^[a-z][a-z0-9_.]{2,80}$'),
  intent_version        integer     NOT NULL CHECK (intent_version BETWEEN 1 AND 999),
  agent_id              text        NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  agent_version         integer     NOT NULL CHECK (agent_version BETWEEN 1 AND 999),
  tool_id               text        NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$'),
  tool_version          integer     NOT NULL CHECK (tool_version BETWEEN 1 AND 999),
  resource_type         text        NOT NULL CHECK (resource_type IN ('work_order', 'room')),
  resource_id           uuid        NOT NULL,
  arguments             jsonb       NOT NULL CHECK (jsonb_typeof(arguments) = 'object' AND pg_column_size(arguments) <= 4096),
  action_digest         text        NOT NULL CHECK (action_digest ~ '^[0-9a-f]{64}$'),
  submitted_by_user_id  uuid        NOT NULL,
  gateway_run_id        uuid        NOT NULL,
  invocation_id         uuid        NOT NULL,
  idempotency_key       text        NOT NULL CHECK (idempotency_key ~ '^handoff:[0-9a-f-]{36}:[1-4]$'),
  proposal_expires_at   timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_proposal_handoffs_planning_fk FOREIGN KEY (planning_run_id)
    REFERENCES public.agent_planning_runs (run_id) ON DELETE CASCADE,
  CONSTRAINT agent_proposal_handoffs_planning_run_fk FOREIGN KEY (planning_run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_proposal_handoffs_gateway_run_fk FOREIGN KEY (gateway_run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_proposal_handoffs_invocation_fk FOREIGN KEY (invocation_id, tenant_id)
    REFERENCES public.agent_tool_invocations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_proposal_handoffs_one_per_proposal UNIQUE (planning_run_id, step_number),
  CONSTRAINT agent_proposal_handoffs_one_per_invocation UNIQUE (invocation_id),
  CONSTRAINT agent_proposal_handoffs_idempotency_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS agent_proposal_handoffs_tenant_idx ON public.agent_proposal_handoffs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_proposal_handoffs_gateway_run_idx ON public.agent_proposal_handoffs (gateway_run_id);

DROP TRIGGER IF EXISTS agent_proposal_handoffs_immutable ON public.agent_proposal_handoffs;
CREATE TRIGGER agent_proposal_handoffs_immutable BEFORE UPDATE OR DELETE ON public.agent_proposal_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();

CREATE OR REPLACE FUNCTION public.agent__handoff_json(p_h public.agent_proposal_handoffs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_h.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_h.id, 'tenant_id', p_h.tenant_id, 'planning_run_id', p_h.planning_run_id, 'plan_digest', p_h.plan_digest,
    'step_number', p_h.step_number, 'intent', p_h.intent, 'intent_version', p_h.intent_version,
    'agent_id', p_h.agent_id, 'agent_version', p_h.agent_version, 'tool_id', p_h.tool_id,
    'tool_version', p_h.tool_version, 'resource_type', p_h.resource_type, 'resource_id', p_h.resource_id,
    'arguments', p_h.arguments, 'action_digest', p_h.action_digest, 'submitted_by_user_id', p_h.submitted_by_user_id,
    'gateway_run_id', p_h.gateway_run_id, 'invocation_id', p_h.invocation_id,
    'proposal_expires_at', p_h.proposal_expires_at, 'created_at', p_h.created_at) END;
$function$;

-- -----------------------------------------------------------------------------
-- Planning admission (redefined; signature unchanged): the resource type now comes from the intent catalog, and a
-- room intent checks room ownership exactly as a work-order intent checks work-order ownership.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_planning_run_admit(
  p_tenant_id uuid, p_user_id uuid, p_intent text, p_intent_version integer, p_resource_type text, p_resource_id uuid,
  p_idempotency_key text, p_request_digest text, p_correlation_id text, p_policy_version text,
  p_deadline_seconds integer, p_max_attempts integer, p_step_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_roles  text[] := public.agent__planning_intent_roles(p_intent, p_intent_version);
  v_rtype  text := public.agent__planning_intent_spec(p_intent, p_intent_version)->>'resource_type';
  v_block  text;
  v_result jsonb;
  v_run_id uuid;
  v_plan   public.agent_planning_runs%ROWTYPE;
BEGIN
  IF v_roles IS NULL OR v_rtype IS NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'intent_not_allowed');
  END IF;
  IF p_resource_type IS DISTINCT FROM v_rtype OR p_resource_id IS NULL
     OR (v_rtype = 'work_order'
         AND NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = p_resource_id AND tenant_id = p_tenant_id))
     OR (v_rtype = 'room'
         AND NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_resource_id AND tenant_id = p_tenant_id)) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'resource_out_of_scope');
  END IF;
  IF p_request_digest IS NULL OR p_request_digest !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'invalid_request');
  END IF;
  IF NOT COALESCE((SELECT enabled FROM public.agent_model_enablement WHERE id = 1), false) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'paid_calls_disabled');
  END IF;
  v_block := public.agent__control_block_reason(p_tenant_id, 'harness.orchestrator');
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', v_block);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags
                  WHERE tenant_id = p_tenant_id AND feature_key = 'ai_agents' AND enabled) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'tenant_capability_disabled');
  END IF;
  IF public.agent__human_authority(p_tenant_id, p_user_id, v_roles) IS NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'actor_not_authorized');
  END IF;

  PERFORM set_config('patelrep.agent_planning_admission', 'on', true);
  v_result := public.agent_run_admit(
    p_tenant_id, 'harness.orchestrator', 1, 'human', p_user_id, NULL, 'user_request', p_idempotency_key,
    p_request_digest, p_correlation_id, p_policy_version, '{}'::jsonb, 'model_planning', p_deadline_seconds,
    p_max_attempts, p_step_max_attempts);
  IF COALESCE((v_result->>'admitted')::boolean, false) AND COALESCE((v_result->>'created')::boolean, false) THEN
    v_run_id := (v_result->>'run_id')::uuid;
    INSERT INTO public.agent_planning_runs (run_id, tenant_id, intent, intent_version, resource_type, resource_id,
                                            initiated_by_user_id, request_digest)
    VALUES (v_run_id, p_tenant_id, p_intent, p_intent_version, p_resource_type, p_resource_id, p_user_id,
            p_request_digest);
  END IF;
  PERFORM set_config('patelrep.agent_planning_admission', '', true);

  IF NOT COALESCE((v_result->>'admitted')::boolean, false) THEN
    RETURN v_result;
  END IF;
  SELECT * INTO v_plan FROM public.agent_planning_runs WHERE run_id = (v_result->>'run_id')::uuid;
  IF NOT FOUND OR v_plan.request_digest IS DISTINCT FROM p_request_digest THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'idempotency_conflict');
  END IF;
  RETURN v_result;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: record which specialist was selected and which verified facts it planned over (fenced)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_planning_record_context(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_agent_id text, p_agent_version integer,
  p_context_digest text, p_fact_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_plan public.agent_planning_runs%ROWTYPE;
  v_spec jsonb;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;
  SELECT * INTO v_plan FROM public.agent_planning_runs WHERE run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'planning_request_missing');
  END IF;
  v_spec := public.agent__planning_intent_spec(v_plan.intent, v_plan.intent_version);
  IF v_spec->'specialist' IS NULL OR jsonb_typeof(v_spec->'specialist') <> 'object'
     OR v_spec->'specialist'->>'agent_id' IS DISTINCT FROM p_agent_id
     OR (v_spec->'specialist'->>'agent_version')::integer IS DISTINCT FROM p_agent_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'specialist_mismatch');
  END IF;
  IF p_context_digest IS NULL OR p_context_digest !~ '^[0-9a-f]{64}$' OR p_fact_keys IS NULL
     OR cardinality(p_fact_keys) NOT BETWEEN 1 AND 4
     OR EXISTS (SELECT 1 FROM unnest(p_fact_keys) k WHERE k !~ '^[a-z][a-z0-9_.]{2,80}@[0-9]{1,3}$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_context');
  END IF;
  PERFORM public.agent__planning_event(v_run.tenant_id, v_run.id, NULL, 'specialist_selected', 'worker', p_worker,
                                       NULL, jsonb_build_object('agent_id', p_agent_id, 'agent_version', p_agent_version));
  PERFORM public.agent__planning_event(v_run.tenant_id, v_run.id, NULL, 'context_gathered', 'worker', p_worker, NULL,
                                       jsonb_build_object('context_digest', p_context_digest, 'facts', to_jsonb(p_fact_keys)));
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: record the plan exactly once (redefined; signature unchanged) -- now also writes the plan audit event
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_planning_record_plan(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_outcome text, p_plan jsonb, p_plan_digest text,
  p_reason_codes text[], p_model_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_plan public.agent_planning_runs%ROWTYPE;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;
  SELECT * INTO v_plan FROM public.agent_planning_runs WHERE run_id = v_run.id AND tenant_id = v_run.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'planning_request_missing');
  END IF;
  IF v_plan.plan_outcome IS NOT NULL THEN
    IF v_plan.plan_outcome = p_outcome AND v_plan.plan_digest IS NOT DISTINCT FROM p_plan_digest THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'planning', public.agent__planning_json(v_plan));
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_already_recorded');
  END IF;
  IF p_reason_codes IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_reason_codes) c WHERE c !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_plan');
  END IF;
  BEGIN
    UPDATE public.agent_planning_runs
       SET plan_outcome = p_outcome, plan = p_plan, plan_digest = p_plan_digest,
           reason_codes = COALESCE(p_reason_codes, '{}'), model_attempts = p_model_attempts, recorded_at = now()
     WHERE run_id = v_plan.run_id
    RETURNING * INTO v_plan;
  EXCEPTION WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_plan');
  END;
  PERFORM public.agent__planning_event(
    v_run.tenant_id, v_run.id, NULL, 'plan_' || v_plan.plan_outcome, 'worker', p_worker,
    CASE WHEN cardinality(v_plan.reason_codes) > 0 THEN v_plan.reason_codes[1] END,
    jsonb_build_object('plan_digest', v_plan.plan_digest, 'model_attempts', v_plan.model_attempts,
                       'proposals', COALESCE(jsonb_array_length(v_plan.plan->'steps'), 0)));
  RETURN jsonb_build_object('ok', true, 'planning', public.agent__planning_json(v_plan));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Verified user: submit ONE validated proposal to the Tool Gateway (the handoff)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_proposal_handoff_admit(
  p_tenant_id uuid, p_user_id uuid, p_planning_run_id uuid, p_plan_digest text, p_step_number integer,
  p_proposal_ttl_seconds integer, p_agent_id text, p_agent_version integer, p_idempotency_key text,
  p_request_digest text, p_correlation_id text, p_policy_version text, p_tool_id text, p_tool_version integer,
  p_arguments jsonb, p_resource_type text, p_resource_id uuid, p_action_digest text, p_deadline_seconds integer,
  p_max_attempts integer, p_step_max_attempts integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_plan    public.agent_planning_runs%ROWTYPE;
  v_h       public.agent_proposal_handoffs%ROWTYPE;
  v_spec    jsonb;
  v_step    jsonb;
  v_ttl     integer := LEAST(GREATEST(COALESCE(p_proposal_ttl_seconds, 900), 60), 3600);
  v_reason  text;
  v_result  jsonb;
  v_actor   text := 'user:' || COALESCE(p_user_id::text, 'unknown');
  v_run_state text;
BEGIN
  SELECT * INTO v_plan FROM public.agent_planning_runs
   WHERE run_id = p_planning_run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_h FROM public.agent_proposal_handoffs
   WHERE planning_run_id = v_plan.run_id AND step_number = p_step_number;
  IF FOUND THEN
    IF v_h.submitted_by_user_id = p_user_id AND v_h.plan_digest = p_plan_digest
       AND v_h.action_digest = p_action_digest AND v_h.arguments = p_arguments THEN
      PERFORM public.agent__planning_event(p_tenant_id, v_plan.run_id, v_h.id, 'handoff_replayed', 'human', v_actor,
                                           NULL, '{}'::jsonb);
      SELECT state INTO v_run_state FROM public.agent_runs WHERE id = v_h.gateway_run_id;
      RETURN jsonb_build_object('admitted', true, 'created', false, 'handoff_id', v_h.id, 'run_id', v_h.gateway_run_id,
                                'invocation_id', v_h.invocation_id, 'state', v_run_state);
    END IF;
    v_reason := 'handoff_conflict';
  END IF;

  v_spec := public.agent__planning_intent_spec(v_plan.intent, v_plan.intent_version);
  v_step := CASE WHEN p_step_number BETWEEN 1 AND 4 THEN v_plan.plan->'steps'->(p_step_number - 1) END;
  IF v_reason IS NOT NULL THEN
    NULL;
  ELSIF v_plan.initiated_by_user_id IS DISTINCT FROM p_user_id THEN
    v_reason := 'not_initiator';
  ELSIF v_plan.plan_outcome IS DISTINCT FROM 'proposed' THEN
    v_reason := 'plan_not_proposed';
  ELSIF v_plan.plan_digest IS DISTINCT FROM p_plan_digest THEN
    v_reason := 'plan_digest_mismatch';
  ELSIF v_plan.recorded_at + make_interval(secs => v_ttl) <= now() THEN
    v_reason := 'proposal_expired';
  ELSIF v_spec IS NULL OR jsonb_typeof(v_spec->'write') IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_spec->'specialist') IS DISTINCT FROM 'object' THEN
    v_reason := 'proposal_not_allowed';
  ELSIF v_step IS NULL OR jsonb_typeof(v_step) <> 'object' THEN
    v_reason := 'proposal_not_found';
  ELSIF (v_plan.plan->>'proposal_only') IS DISTINCT FROM 'true'
        OR (v_plan.plan->>'authorizes_execution') IS DISTINCT FROM 'false'
        OR v_step->'tool'->>'access' IS DISTINCT FROM 'write'
        OR (v_step->'tool'->>'requires_human_approval') IS DISTINCT FROM 'true' THEN
    v_reason := 'proposal_invalid';
  ELSIF v_plan.plan->'agent'->>'id' IS DISTINCT FROM p_agent_id
        OR (v_plan.plan->'agent'->>'version')::integer IS DISTINCT FROM p_agent_version
        OR v_spec->'specialist'->>'agent_id' IS DISTINCT FROM p_agent_id
        OR (v_spec->'specialist'->>'agent_version')::integer IS DISTINCT FROM p_agent_version
        OR v_step->'tool'->>'id' IS DISTINCT FROM p_tool_id
        OR (v_step->'tool'->>'version')::integer IS DISTINCT FROM p_tool_version
        OR v_spec->'write'->>'tool_id' IS DISTINCT FROM p_tool_id
        OR (v_spec->'write'->>'tool_version')::integer IS DISTINCT FROM p_tool_version THEN
    v_reason := 'proposal_changed';
  ELSIF v_step->'arguments' IS DISTINCT FROM p_arguments THEN
    v_reason := 'proposal_changed';
  ELSIF p_resource_type IS DISTINCT FROM v_plan.resource_type OR p_resource_id IS DISTINCT FROM v_plan.resource_id THEN
    v_reason := 'resource_out_of_scope';
  ELSIF p_idempotency_key IS DISTINCT FROM 'handoff:' || v_plan.run_id::text || ':' || p_step_number::text THEN
    v_reason := 'invalid_idempotency_key';
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM public.agent__planning_event(p_tenant_id, v_plan.run_id, NULL, 'handoff_refused', 'human', v_actor,
                                         v_reason, jsonb_build_object('step_number', p_step_number));
    RETURN jsonb_build_object('admitted', false, 'reason', v_reason);
  END IF;

  -- The gateway re-checks its own allowlist, resource ownership, controls, entitlement, the initiator's CURRENT
  -- authority and the per-property grant, in this same transaction.
  v_result := public.agent_tool_run_admit(
    p_tenant_id, p_agent_id, p_agent_version, p_user_id, p_idempotency_key, p_request_digest, p_correlation_id,
    p_policy_version, p_tool_id, p_tool_version, p_arguments, p_resource_type, p_resource_id, p_action_digest,
    p_deadline_seconds, p_max_attempts, p_step_max_attempts);
  IF NOT COALESCE((v_result->>'admitted')::boolean, false)
     OR NOT COALESCE((v_result->>'created')::boolean, false) THEN
    v_reason := CASE WHEN COALESCE((v_result->>'admitted')::boolean, false) THEN 'idempotency_conflict'
                     ELSE COALESCE(v_result->>'reason', 'admission_refused') END;
    PERFORM public.agent__planning_event(p_tenant_id, v_plan.run_id, NULL, 'handoff_refused', 'human', v_actor,
                                         left(v_reason, 64), jsonb_build_object('step_number', p_step_number));
    RETURN jsonb_build_object('admitted', false, 'reason', v_reason);
  END IF;

  INSERT INTO public.agent_proposal_handoffs (
    tenant_id, planning_run_id, plan_digest, step_number, intent, intent_version, agent_id, agent_version, tool_id,
    tool_version, resource_type, resource_id, arguments, action_digest, submitted_by_user_id, gateway_run_id,
    invocation_id, idempotency_key, proposal_expires_at)
  VALUES (
    p_tenant_id, v_plan.run_id, p_plan_digest, p_step_number, v_plan.intent, v_plan.intent_version, p_agent_id,
    p_agent_version, p_tool_id, p_tool_version, p_resource_type, p_resource_id, p_arguments, p_action_digest, p_user_id,
    (v_result->>'run_id')::uuid, (v_result->>'invocation_id')::uuid, p_idempotency_key,
    v_plan.recorded_at + make_interval(secs => v_ttl))
  RETURNING * INTO v_h;
  PERFORM public.agent__planning_event(p_tenant_id, v_plan.run_id, v_h.id, 'handoff_submitted', 'human', v_actor, NULL,
                                       jsonb_build_object('tool_id', p_tool_id, 'tool_version', p_tool_version,
                                                          'gateway_run_id', v_h.gateway_run_id));
  RETURN v_result || jsonb_build_object('handoff_id', v_h.id);
END;
$function$;

-- Status of one handoff: the binding plus the live gateway run, approval and execution outcome.
CREATE OR REPLACE FUNCTION public.agent_proposal_handoff_get(p_tenant_id uuid, p_handoff_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'handoff', public.agent__handoff_json(h),
    'run_state', r.state,
    'approval', public.agent__approval_json(a),
    'execution', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
      'state', e.state, 'error_code', e.error_code, 'result', e.result, 'created_at', e.created_at) END)
  FROM public.agent_proposal_handoffs h
  JOIN public.agent_runs r ON r.id = h.gateway_run_id AND r.tenant_id = h.tenant_id
  LEFT JOIN public.agent_tool_approvals a ON a.invocation_id = h.invocation_id
  LEFT JOIN public.agent_tool_executions e ON e.invocation_id = h.invocation_id
  WHERE h.id = p_handoff_id AND h.tenant_id = p_tenant_id;
$function$;

CREATE OR REPLACE FUNCTION public.agent_proposal_handoffs_for_run(p_tenant_id uuid, p_planning_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent_proposal_handoff_get(p_tenant_id, h.id) ORDER BY h.step_number), '[]'::jsonb)
  FROM public.agent_proposal_handoffs h
  WHERE h.tenant_id = p_tenant_id AND h.planning_run_id = p_planning_run_id;
$function$;

-- Verified initiator withdraws a submitted proposal before it executes: revokes an unconsumed approval and cancels
-- the gateway run, in one transaction. A committed execution can never be withdrawn here.
CREATE OR REPLACE FUNCTION public.agent_proposal_handoff_cancel(p_tenant_id uuid, p_handoff_id uuid, p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_h     public.agent_proposal_handoffs%ROWTYPE;
  v_appr  public.agent_tool_approvals%ROWTYPE;
  v_run   public.agent_runs%ROWTYPE;
  v_actor text := 'user:' || COALESCE(p_actor_user_id::text, 'unknown');
  v_cancel jsonb;
BEGIN
  SELECT * INTO v_h FROM public.agent_proposal_handoffs WHERE id = p_handoff_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_h.submitted_by_user_id IS DISTINCT FROM p_actor_user_id
     OR public.agent__human_authority(p_tenant_id, p_actor_user_id,
                                      public.agent__planning_intent_roles(v_h.intent, v_h.intent_version)) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = v_h.gateway_run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.agent_tool_executions WHERE invocation_id = v_h.invocation_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_executed');
  END IF;
  SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE invocation_id = v_h.invocation_id FOR UPDATE;
  IF FOUND AND v_appr.state IN ('requested', 'approved') AND v_appr.consumed_at IS NULL THEN
    UPDATE public.agent_tool_approvals SET state = 'revoked', ended_by = v_actor, ended_at = now(),
           decision_reason_code = COALESCE(decision_reason_code, 'proposal_withdrawn')
     WHERE id = v_appr.id;
    PERFORM public.agent__tool_event(p_tenant_id, v_h.gateway_run_id, v_h.invocation_id, v_appr.id, NULL,
                                     'approval_revoked', 'human', v_actor, 'proposal_withdrawn', NULL, '{}'::jsonb);
  END IF;
  v_cancel := public.agent_run_request_cancel(p_tenant_id, v_h.gateway_run_id, v_actor);
  PERFORM public.agent__planning_event(p_tenant_id, v_h.planning_run_id, v_h.id, 'handoff_cancelled', 'human', v_actor,
                                       'proposal_withdrawn', jsonb_build_object('run_outcome', v_cancel->>'outcome'));
  RETURN jsonb_build_object('ok', true, 'run_outcome', v_cancel->>'outcome', 'run_state', v_cancel->>'state');
END;
$function$;

-- Verified initiator dismisses a recommendation (human review: "not acting on this"). Audit only; changes nothing.
CREATE OR REPLACE FUNCTION public.agent_planning_dismiss(p_tenant_id uuid, p_run_id uuid, p_actor_user_id uuid,
                                                         p_reason_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_plan public.agent_planning_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.agent_planning_runs WHERE run_id = p_run_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_plan.initiated_by_user_id IS DISTINCT FROM p_actor_user_id
     OR public.agent__human_authority(p_tenant_id, p_actor_user_id,
                                      public.agent__planning_intent_roles(v_plan.intent, v_plan.intent_version)) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  IF v_plan.plan_outcome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_recorded');
  END IF;
  PERFORM public.agent__planning_event(p_tenant_id, v_plan.run_id, NULL, 'recommendation_dismissed', 'human',
                                       'user:' || p_actor_user_id::text,
                                       CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END,
                                       '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_planning_events_page(p_tenant_id uuid, p_run_id uuid, p_after_id bigint DEFAULT 0,
                                                             p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'handoff_id', e.handoff_id, 'event_type', e.event_type, 'actor_kind', e.actor_kind,
           'actor_ref', e.actor_ref, 'reason_code', e.reason_code, 'detail', e.detail, 'created_at', e.created_at)
           ORDER BY e.id), '[]'::jsonb)
  FROM (SELECT * FROM public.agent_planning_events
         WHERE tenant_id = p_tenant_id AND run_id = p_run_id AND id > COALESCE(p_after_id, 0)
         ORDER BY id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) e;
$function$;

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_planning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_proposal_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_planning_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.agent_proposal_handoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agent_planning_events TO service_role;
GRANT SELECT, INSERT ON public.agent_proposal_handoffs TO service_role;

REVOKE ALL ON FUNCTION public.agent__planning_intent_roles(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__planning_intent_spec(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__planning_event(uuid, uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__handoff_json(public.agent_proposal_handoffs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_run_admit(uuid, uuid, text, integer, text, uuid, text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_record_context(uuid, bigint, text, text, integer, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_proposal_handoff_admit(uuid, uuid, uuid, text, integer, integer, text, integer, text, text, text, text, text, integer, jsonb, text, uuid, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_proposal_handoff_get(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_proposal_handoffs_for_run(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_proposal_handoff_cancel(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_dismiss(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_events_page(uuid, uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent__planning_intent_roles(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__planning_intent_spec(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__planning_event(uuid, uuid, uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__handoff_json(public.agent_proposal_handoffs) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_run_admit(uuid, uuid, text, integer, text, uuid, text, text, text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_record_context(uuid, bigint, text, text, integer, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_proposal_handoff_admit(uuid, uuid, uuid, text, integer, integer, text, integer, text, text, text, text, text, integer, jsonb, text, uuid, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_proposal_handoff_get(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_proposal_handoffs_for_run(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_proposal_handoff_cancel(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_dismiss(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_events_page(uuid, uuid, bigint, integer) TO service_role;
