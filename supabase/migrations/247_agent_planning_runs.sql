-- =============================================================================
-- Migration 247: Agent Harness H3 -- planning runs (request + recorded plan) and their fenced RPCs
-- =============================================================================
-- Additive only. A planning run is an ordinary H1 run of harness.orchestrator v1 (admitted by migration 246's allowlist)
-- with exactly one model_planning step. agent_planning_runs stores the immutable, server-built REQUEST (a closed intent
-- plus a server-verified resource id -- no free text, no prompt) and, once, the deterministically validated PLAN.
-- Plans are proposals: nothing here (or anywhere in H3) submits them to the Tool Gateway.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_planning_runs (
  run_id                uuid        PRIMARY KEY,
  tenant_id             uuid        NOT NULL,
  intent                text        NOT NULL CHECK (intent IN ('engineering.work_order_dispatch_plan')),
  intent_version        integer     NOT NULL CHECK (intent_version = 1),
  resource_type         text        NOT NULL CHECK (resource_type IN ('work_order')),
  resource_id           uuid        NOT NULL,
  initiated_by_user_id  uuid        NOT NULL,
  request_digest        text        NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  plan_outcome          text        CHECK (plan_outcome IN ('proposed', 'refused', 'escalated', 'rejected')),
  plan                  jsonb       CHECK (plan IS NULL OR (jsonb_typeof(plan) = 'object' AND pg_column_size(plan) <= 8192)),
  plan_digest           text        CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  reason_codes          text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(reason_codes) <= 8),
  model_attempts        integer     CHECK (model_attempts BETWEEN 0 AND 50),
  recorded_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_planning_runs_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_planning_runs_record_shape CHECK (
    (plan_outcome IS NULL) = (recorded_at IS NULL)
    AND (plan IS NULL) = (plan_digest IS NULL)
    AND (plan_outcome IS DISTINCT FROM 'rejected' OR plan IS NULL)
    AND (plan_outcome NOT IN ('proposed', 'refused', 'escalated') OR plan IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agent_planning_runs_tenant_idx ON public.agent_planning_runs (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.agent__guard_planning_run()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'planning runs are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan_outcome IS NOT NULL OR COALESCE(current_setting('patelrep.agent_planning_admission', true), '') <> 'on' THEN
      RAISE EXCEPTION 'planning requests are inserted only by agent_planning_run_admit' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.plan_outcome IS NOT NULL OR NEW.plan_outcome IS NULL
     OR (to_jsonb(NEW) - 'plan_outcome' - 'plan' - 'plan_digest' - 'reason_codes' - 'model_attempts' - 'recorded_at')
        IS DISTINCT FROM
        (to_jsonb(OLD) - 'plan_outcome' - 'plan' - 'plan_digest' - 'reason_codes' - 'model_attempts' - 'recorded_at') THEN
    RAISE EXCEPTION 'a plan is recorded exactly once and the request never changes' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_planning_runs_guard ON public.agent_planning_runs;
CREATE TRIGGER agent_planning_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_planning_runs
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_planning_run();

-- Roles that may request a plan for an intent. Mirrors services/agent_orchestrator/orchestrator.py INTENTS (drift test).
CREATE OR REPLACE FUNCTION public.agent__planning_intent_roles(p_intent text, p_intent_version integer)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_intent = 'engineering.work_order_dispatch_plan' AND p_intent_version = 1
              THEN ARRAY['chief_engineer', 'gm'] END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__planning_json(p_p public.agent_planning_runs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_p.run_id IS NULL THEN NULL ELSE jsonb_build_object(
    'run_id', p_p.run_id, 'tenant_id', p_p.tenant_id, 'intent', p_p.intent, 'intent_version', p_p.intent_version,
    'resource_type', p_p.resource_type, 'resource_id', p_p.resource_id,
    'initiated_by_user_id', p_p.initiated_by_user_id, 'plan_outcome', p_p.plan_outcome, 'plan', p_p.plan,
    'plan_digest', p_p.plan_digest, 'reason_codes', to_jsonb(p_p.reason_codes), 'model_attempts', p_p.model_attempts,
    'recorded_at', p_p.recorded_at, 'created_at', p_p.created_at) END;
$function$;

-- -----------------------------------------------------------------------------
-- Admission (verified user; service role). One transaction: run + step 1 + pgmq message + planning request.
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
  v_block  text;
  v_result jsonb;
  v_run_id uuid;
  v_plan   public.agent_planning_runs%ROWTYPE;
BEGIN
  IF v_roles IS NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'intent_not_allowed');
  END IF;
  IF p_resource_type IS DISTINCT FROM 'work_order' OR p_resource_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = p_resource_id AND tenant_id = p_tenant_id) THEN
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
-- Worker: fenced planning context and the single plan record
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_planning_step_context(p_run_id uuid, p_fencing_token bigint, p_worker text)
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
  SELECT * INTO v_plan FROM public.agent_planning_runs WHERE run_id = v_run.id AND tenant_id = v_run.tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'planning_request_missing');
  END IF;
  RETURN jsonb_build_object('ok', true, 'planning', public.agent__planning_json(v_plan),
                            'deadline_at', v_run.deadline_at, 'db_now', now());
END;
$function$;

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
  RETURN jsonb_build_object('ok', true, 'planning', public.agent__planning_json(v_plan));
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_planning_run_get(p_tenant_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT public.agent__planning_json(p) FROM public.agent_planning_runs p
   WHERE p.run_id = p_run_id AND p.tenant_id = p_tenant_id;
$function$;

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_planning_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_planning_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_planning_runs TO service_role;

REVOKE ALL ON FUNCTION public.agent__guard_planning_run() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__planning_intent_roles(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__planning_json(public.agent_planning_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_run_admit(uuid, uuid, text, integer, text, uuid, text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_step_context(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_planning_run_get(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent__planning_intent_roles(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__planning_json(public.agent_planning_runs) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_run_admit(uuid, uuid, text, integer, text, uuid, text, text, text, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_step_context(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_planning_run_get(uuid, uuid) TO service_role;
