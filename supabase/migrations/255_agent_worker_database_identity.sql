-- =============================================================================
-- Migration 255: Agent Harness H6 -- least-privileged worker database identity (agent_worker)
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. Nothing is dropped, renamed, deleted or rewritten. The destructive-SQL guard flags this
--   file only because it contains the TRUNCATE keyword (a BEFORE TRUNCATE refusal trigger on the new credential
--   registry). Exact effect:
--   (1) creates the NOLOGIN, NOINHERIT, NOBYPASSRLS role agent_worker (no memberships) and lets PostgREST's
--       authenticator switch to it, so a JWT whose role claim is agent_worker runs as that role and nothing more;
--   (2) creates agent_worker_credentials, the registry of the jti of every worker token (max 31-day life, revocable,
--       immutable except one revocation); a token whose jti is not registered, active and unexpired is refused;
--   (3) creates 22 SECURITY DEFINER pass-through wrappers (agent_worker_rpc__<rpc>) for exactly the reviewed fenced
--       execution, gateway-step, planning, accounting and recovery RPCs, plus a read-only runtime-controls snapshot.
--       Each checks the credential first and then calls the unchanged H1-H5 function with the same arguments, so every
--       tenant check, lease fence, approval-consumption rule and migration-254 trigger still applies;
--   (4) grants agent_worker SELECT on the exact columns the worker reads (identity, gateway context) behind a
--       role-scoped RLS policy that also requires an active credential. No INSERT/UPDATE/DELETE anywhere.
--   The worker can NOT execute agent_tool_approval_decide/revoke, grant, enablement, control, pricing, budget,
--   overage, reconciliation, admission or domain RPCs (work_order_assign_apply, publish_assignment_batch): it holds no
--   EXECUTE on any of them and none is granted to PUBLIC (asserted by agent_worker_privilege_violations()).
--   To undo a grant, a NEW reviewed forward migration revokes it; REVOKE agent_worker FROM authenticator disables every
--   worker token at once. No switch, flag, credential or worker deployment is created here. Agent execution, paid
--   model calls and customer billing stay disabled.
--
-- Why PostgREST + a custom JWT role and not a direct database login: through PostgREST the worker can only reach
--   objects in the exposed API schema that it holds privileges on. A LOGIN role on a direct connection could also
--   execute every PUBLIC-executable function of every schema it can see (for example pg_net's net.http_* functions,
--   which the local Supabase image grants to PUBLIC), i.e. an arbitrary-HTTP primitive. The API keeps service_role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) The role
-- -----------------------------------------------------------------------------
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker') THEN
    CREATE ROLE agent_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- A pre-existing role must have exactly these attributes and no memberships; anything else fails closed.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker'
              AND (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'agent_worker exists with privileged attributes' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = 'agent_worker'::regrole) THEN
    RAISE EXCEPTION 'agent_worker must not be a member of any role' USING ERRCODE = '42501';
  END IF;
END;
$role$;

GRANT agent_worker TO authenticator;
COMMENT ON ROLE agent_worker IS
  'Agent Harness worker (migration 255). Reached only through PostgREST with a registered agent_worker JWT. Executes only the agent_worker_rpc__* wrappers; reads only reviewed columns. Never decides approvals, changes controls or writes business tables directly.';

-- -----------------------------------------------------------------------------
-- (2) Credential registry (jti of each worker token)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_worker_credentials (
  id             uuid        PRIMARY KEY,
  label          text        NOT NULL CHECK (label ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  app_env        text        NOT NULL CHECK (app_env IN ('development', 'test', 'staging', 'production')),
  issued_by      text        NOT NULL CHECK (issued_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_by     text        CHECK (revoked_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  revoke_reason  text        CHECK (revoke_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT agent_worker_credentials_lifetime CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '31 days'),
  CONSTRAINT agent_worker_credentials_revocation CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

ALTER TABLE public.agent_worker_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_worker_credentials FROM PUBLIC, anon, authenticated, agent_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_worker_credentials TO service_role;

-- Immutable except one revocation; never deleted; never truncated.
CREATE OR REPLACE FUNCTION public.agent__guard_worker_credential()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent worker credentials are kept for audit; revoke instead of deleting' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked agent worker credential is final' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.label, NEW.app_env, NEW.issued_by, NEW.issued_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.id, OLD.label, OLD.app_env, OLD.issued_by, OLD.issued_at, OLD.expires_at)
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'only revocation may change an agent worker credential' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_worker_credentials_guard'
                  AND tgrelid = 'public.agent_worker_credentials'::regclass) THEN
    CREATE TRIGGER agent_worker_credentials_guard BEFORE UPDATE OR DELETE ON public.agent_worker_credentials
      FOR EACH ROW EXECUTE FUNCTION public.agent__guard_worker_credential();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_refuse_truncate'
                  AND tgrelid = 'public.agent_worker_credentials'::regclass) THEN
    CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_worker_credentials
      FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
  END IF;
END;
$trg$;

-- PostgREST sets request.jwt.claims from the VERIFIED token for every request; this role runs no SQL of its own, so it
-- cannot set it. The check is the token's role claim plus an active, unexpired registry row for its jti.
CREATE OR REPLACE FUNCTION public.agent__worker_credential_ok()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_jti    text;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_claims IS NULL OR jsonb_typeof(v_claims) <> 'object' OR v_claims->>'role' IS DISTINCT FROM 'agent_worker' THEN
    RETURN false;
  END IF;
  v_jti := v_claims->>'jti';
  IF v_jti IS NULL OR v_jti !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.agent_worker_credentials c
                  WHERE c.id = v_jti::uuid AND c.revoked_at IS NULL AND c.expires_at > now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__worker_assert()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT public.agent__worker_credential_ok() THEN
    RAISE EXCEPTION 'agent_worker_credential_invalid' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Operator lifecycle (service_role only; the minting operator also needs the project JWT secret, which the worker
-- never holds). Registration refuses a reused jti; revocation takes effect on the very next request.
CREATE OR REPLACE FUNCTION public.agent_worker_credential_register(
  p_id uuid, p_label text, p_app_env text, p_expires_at timestamptz, p_issued_by text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_worker_credentials%ROWTYPE;
BEGIN
  INSERT INTO public.agent_worker_credentials (id, label, app_env, issued_by, expires_at)
  VALUES (p_id, p_label, p_app_env, p_issued_by, p_expires_at)
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'credential_exists');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'expires_at', v_row.expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_credential_revoke(p_id uuid, p_revoked_by text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_worker_credentials%ROWTYPE;
BEGIN
  UPDATE public.agent_worker_credentials SET revoked_at = now(), revoked_by = p_revoked_by, revoke_reason = p_reason
   WHERE id = p_id AND revoked_at IS NULL
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', v_row.id IS NOT NULL, 'reason', CASE WHEN v_row.id IS NULL THEN 'not_active' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_credentials_list(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'app_env', c.app_env,
                                               'issued_by', c.issued_by, 'issued_at', c.issued_at,
                                               'expires_at', c.expires_at, 'revoked_at', c.revoked_at,
                                               'revoked_by', c.revoked_by, 'revoke_reason', c.revoke_reason,
                                               'active', c.revoked_at IS NULL AND c.expires_at > now())
                            ORDER BY c.issued_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_worker_credentials ORDER BY issued_at DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) c;
$function$;

-- -----------------------------------------------------------------------------
-- (3) Runtime-controls snapshot (read-only; replaces the worker's direct table read) and the reviewed wrappers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_runtime_controls_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('scope', c.scope, 'tenant_id', c.tenant_id, 'agent_id', c.agent_id,
                                               'paused', c.paused, 'cost_emergency_stop', c.cost_emergency_stop)), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_runtime_controls ORDER BY scope, tenant_id, agent_id LIMIT 1000) c;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_runtime_controls_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_runtime_controls_snapshot();
END;
$function$;

-- H1 fenced execution and recovery
CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_claim(p_worker text, p_lease_seconds integer DEFAULT 60, p_vt_margin integer DEFAULT 15, p_poison_read_ct integer DEFAULT 10, p_blocked_retry integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_run_claim(p_worker => p_worker, p_lease_seconds => p_lease_seconds, p_vt_margin => p_vt_margin, p_poison_read_ct => p_poison_read_ct, p_blocked_retry => p_blocked_retry);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_heartbeat(p_run_id uuid, p_fencing_token bigint, p_worker text, p_lease_seconds integer DEFAULT 60, p_vt_margin integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_run_heartbeat(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_lease_seconds => p_lease_seconds, p_vt_margin => p_vt_margin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_step_complete(p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text, p_result_meta jsonb DEFAULT '{}'::jsonb, p_next_step_type text DEFAULT NULL::text, p_next_step_max_attempts integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_step_complete(p_run_id => p_run_id, p_step_id => p_step_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_result_meta => p_result_meta, p_next_step_type => p_next_step_type, p_next_step_max_attempts => p_next_step_max_attempts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_step_fail(p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text, p_error_class text, p_error_code text, p_retryable boolean, p_retry_delay_seconds integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_step_fail(p_run_id => p_run_id, p_step_id => p_step_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_error_class => p_error_class, p_error_code => p_error_code, p_retryable => p_retryable, p_retry_delay_seconds => p_retry_delay_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_run_acknowledge(p_run_id uuid, p_fencing_token bigint, p_worker text, p_action text, p_reason text DEFAULT NULL::text, p_yield_delay_seconds integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_run_acknowledge(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_action => p_action, p_reason => p_reason, p_yield_delay_seconds => p_yield_delay_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_runs_recover(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_runs_recover(p_limit => p_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_worker_heartbeat(p_worker_id text, p_status text, p_app_env text, p_version text, p_concurrency integer, p_in_flight integer, p_started_at timestamp with time zone)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  PERFORM public.agent_worker_heartbeat(p_worker_id => p_worker_id, p_status => p_status, p_app_env => p_app_env, p_version => p_version, p_concurrency => p_concurrency, p_in_flight => p_in_flight, p_started_at => p_started_at);
END;
$function$;

-- H2/H5 Tool Gateway steps (no decision, grant or control RPC)
CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_authorization_snapshot(p_tenant_id uuid, p_agent_id text, p_agent_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_authorization_snapshot(p_tenant_id => p_tenant_id, p_agent_id => p_agent_id, p_agent_version => p_agent_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_step_context(p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_number integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_step_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_step_number => p_step_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_request_approval(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_approval_policy_id text, p_approver_may_be_initiator boolean, p_ttl_seconds integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_request_approval(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_approval_policy_id => p_approval_policy_id, p_approver_may_be_initiator => p_approver_may_be_initiator, p_ttl_seconds => p_ttl_seconds);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_record_outcome(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_state text, p_result jsonb DEFAULT '{}'::jsonb, p_error_class text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_record_outcome(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_state => p_state, p_result => p_result, p_error_class => p_error_class, p_error_code => p_error_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_execute_work_order_assign(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_action_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_execute_work_order_assign(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_action_digest => p_action_digest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_execute_room_assignment(p_run_id uuid, p_fencing_token bigint, p_worker text, p_invocation_id uuid, p_action_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_execute_room_assignment(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_invocation_id => p_invocation_id, p_action_digest => p_action_digest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_tool_approvals_expire(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_tool_approvals_expire(p_limit => p_limit);
END;
$function$;

-- H3/H5 planning steps
CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_step_context(p_run_id uuid, p_fencing_token bigint, p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_planning_step_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_record_plan(p_run_id uuid, p_fencing_token bigint, p_worker text, p_outcome text, p_plan jsonb, p_plan_digest text, p_reason_codes text[], p_model_attempts integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_planning_record_plan(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_outcome => p_outcome, p_plan => p_plan, p_plan_digest => p_plan_digest, p_reason_codes => p_reason_codes, p_model_attempts => p_model_attempts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_planning_record_context(p_run_id uuid, p_fencing_token bigint, p_worker text, p_agent_id text, p_agent_version integer, p_context_digest text, p_fact_keys text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_planning_record_context(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_agent_id => p_agent_id, p_agent_version => p_agent_version, p_context_digest => p_context_digest, p_fact_keys => p_fact_keys);
END;
$function$;

-- H3/H4 accounting through the H4 wrappers, and spend recovery
CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_reserve(p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_id uuid, p_logical_call_key text, p_attempt_number integer, p_provider text, p_model text, p_schedule_version text, p_max_input_tokens integer, p_max_output_tokens integer, p_exposure_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_billing_attempt_reserve(p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker, p_step_id => p_step_id, p_logical_call_key => p_logical_call_key, p_attempt_number => p_attempt_number, p_provider => p_provider, p_model => p_model, p_schedule_version => p_schedule_version, p_max_input_tokens => p_max_input_tokens, p_max_output_tokens => p_max_output_tokens, p_exposure_usd => p_exposure_usd);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_dispatch(p_attempt_id uuid, p_run_id uuid, p_fencing_token bigint, p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_billing_attempt_dispatch(p_attempt_id => p_attempt_id, p_run_id => p_run_id, p_fencing_token => p_fencing_token, p_worker => p_worker);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_release(p_attempt_id uuid, p_fencing_token bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_billing_attempt_release(p_attempt_id => p_attempt_id, p_fencing_token => p_fencing_token, p_reason => p_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_billing_attempt_settle(p_attempt_id uuid, p_fencing_token bigint, p_outcome text, p_cost_usd numeric, p_usage_status text, p_usage jsonb, p_cost_status text, p_cost_cause text, p_cost_tier text, p_reported_model text, p_provider_request_id text, p_provider_response_id text, p_error_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_billing_attempt_settle(p_attempt_id => p_attempt_id, p_fencing_token => p_fencing_token, p_outcome => p_outcome, p_cost_usd => p_cost_usd, p_usage_status => p_usage_status, p_usage => p_usage, p_cost_status => p_cost_status, p_cost_cause => p_cost_cause, p_cost_tier => p_cost_tier, p_reported_model => p_reported_model, p_provider_request_id => p_provider_request_id, p_provider_response_id => p_provider_response_id, p_error_code => p_error_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_rpc__agent_model_attempts_recover(p_stale_seconds integer DEFAULT 900, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__worker_assert();
  RETURN public.agent_model_attempts_recover(p_stale_seconds => p_stale_seconds, p_limit => p_limit);
END;
$function$;

-- Wrapper privileges: agent_worker only (PUBLIC/anon/authenticated/service_role revoked; re-asserted by 256).
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_run_claim(text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_run_claim(text, integer, integer, integer, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_run_heartbeat(uuid, bigint, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_run_heartbeat(uuid, bigint, text, integer, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_step_complete(uuid, uuid, bigint, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_step_complete(uuid, uuid, bigint, text, jsonb, text, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_step_fail(uuid, uuid, bigint, text, text, text, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_step_fail(uuid, uuid, bigint, text, text, text, boolean, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_run_acknowledge(uuid, bigint, text, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_run_acknowledge(uuid, bigint, text, text, text, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_runs_recover(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_runs_recover(integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_worker_heartbeat(text, text, text, text, integer, integer, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_worker_heartbeat(text, text, text, text, integer, integer, timestamp with time zone) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_authorization_snapshot(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_authorization_snapshot(uuid, text, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_step_context(uuid, bigint, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_step_context(uuid, bigint, text, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_request_approval(uuid, bigint, text, uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_request_approval(uuid, bigint, text, uuid, text, boolean, integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_record_outcome(uuid, bigint, text, uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_record_outcome(uuid, bigint, text, uuid, text, jsonb, text, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_execute_work_order_assign(uuid, bigint, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_execute_work_order_assign(uuid, bigint, text, uuid, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_execute_room_assignment(uuid, bigint, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_execute_room_assignment(uuid, bigint, text, uuid, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_tool_approvals_expire(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_tool_approvals_expire(integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_planning_step_context(uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_planning_step_context(uuid, bigint, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_planning_record_plan(uuid, bigint, text, text, jsonb, text, text[], integer) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_planning_record_context(uuid, bigint, text, text, integer, text, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_planning_record_context(uuid, bigint, text, text, integer, text, text[]) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_reserve(uuid, bigint, text, uuid, text, integer, text, text, text, integer, integer, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_reserve(uuid, bigint, text, uuid, text, integer, text, text, text, integer, integer, numeric) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_dispatch(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_dispatch(uuid, uuid, bigint, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_release(uuid, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_release(uuid, bigint, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_settle(uuid, bigint, text, numeric, text, jsonb, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_billing_attempt_settle(uuid, bigint, text, numeric, text, jsonb, text, text, text, text, text, text, text) TO agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_model_attempts_recover(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_model_attempts_recover(integer, integer) TO agent_worker;

REVOKE ALL ON FUNCTION public.agent_worker_rpc__agent_runtime_controls_snapshot() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_rpc__agent_runtime_controls_snapshot() TO agent_worker;

-- Internal helpers and operator RPCs
REVOKE ALL ON FUNCTION public.agent__guard_worker_credential() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__worker_assert() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__worker_credential_ok() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent__worker_credential_ok() TO agent_worker;  -- evaluated by the RLS policies below
REVOKE ALL ON FUNCTION public.agent_worker_credential_register(uuid, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_credential_revoke(uuid, text, text) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_credentials_list(integer) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_runtime_controls_snapshot() FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_worker_credential_register(uuid, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_credential_revoke(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_credentials_list(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_runtime_controls_snapshot() TO service_role;

-- -----------------------------------------------------------------------------
-- (4) Column-scoped reads (identity revalidation + verified gateway context), behind an active credential
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO agent_worker;
GRANT SELECT (id, is_active, timezone) ON public.tenants TO agent_worker;
GRANT SELECT (id, tenant_id, is_active) ON public.user_profiles TO agent_worker;
GRANT SELECT (user_id, tenant_id, role, is_active) ON public.user_roles TO agent_worker;
GRANT SELECT (id, tenant_id, work_order_number, title, status, priority, assigned_to, due_at, room_id) ON public.work_orders TO agent_worker;
GRANT SELECT (id, tenant_id, room_number, floor, building, is_active) ON public.rooms TO agent_worker;
GRANT SELECT (room_id, tenant_id, status, fo_status, clean_type, assigned_to, dnd_flag, do_not_service, dnd_retry_at, updated_at) ON public.room_status TO agent_worker;
GRANT SELECT (id, tenant_id, room_id, assigned_to, assignment_date) ON public.room_assignments TO agent_worker;
GRANT SELECT (id, tenant_id, room_id, status) ON public.room_occupancy_discrepancies TO agent_worker;

DO $policies$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['tenants', 'user_profiles', 'user_roles', 'work_orders', 'rooms', 'room_status',
                                 'room_assignments', 'room_occupancy_discrepancies'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = v_table
                    AND policyname = 'agent_worker_read') THEN
      EXECUTE format('CREATE POLICY agent_worker_read ON public.%I FOR SELECT TO agent_worker '
                     'USING ((SELECT public.agent__worker_credential_ok()))', v_table);
    END IF;
  END LOOP;
END;
$policies$;

-- -----------------------------------------------------------------------------
-- (5) The reviewed contract, as data, and a fail-closed verifier
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__worker_allowed_rpcs()
RETURNS SETOF text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT unnest(ARRAY[
    'agent_run_claim', 'agent_run_heartbeat', 'agent_step_complete', 'agent_step_fail', 'agent_run_acknowledge',
    'agent_runs_recover', 'agent_worker_heartbeat',
    'agent_tool_authorization_snapshot', 'agent_tool_step_context', 'agent_tool_request_approval',
    'agent_tool_record_outcome', 'agent_tool_execute_work_order_assign', 'agent_tool_execute_room_assignment',
    'agent_tool_approvals_expire',
    'agent_planning_step_context', 'agent_planning_record_plan', 'agent_planning_record_context',
    'agent_billing_attempt_reserve', 'agent_billing_attempt_dispatch', 'agent_billing_attempt_release',
    'agent_billing_attempt_settle', 'agent_model_attempts_recover',
    'agent_runtime_controls_snapshot']);
$function$;

CREATE OR REPLACE FUNCTION public.agent__worker_read_columns()
RETURNS TABLE (table_name text, column_name text) LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT t.table_name, unnest(t.columns) FROM (VALUES
    ('tenants', ARRAY['id', 'is_active', 'timezone']),
    ('user_profiles', ARRAY['id', 'tenant_id', 'is_active']),
    ('user_roles', ARRAY['user_id', 'tenant_id', 'role', 'is_active']),
    ('work_orders', ARRAY['id', 'tenant_id', 'work_order_number', 'title', 'status', 'priority', 'assigned_to', 'due_at', 'room_id']),
    ('rooms', ARRAY['id', 'tenant_id', 'room_number', 'floor', 'building', 'is_active']),
    ('room_status', ARRAY['room_id', 'tenant_id', 'status', 'fo_status', 'clean_type', 'assigned_to', 'dnd_flag', 'do_not_service', 'dnd_retry_at', 'updated_at']),
    ('room_assignments', ARRAY['id', 'tenant_id', 'room_id', 'assigned_to', 'assignment_date']),
    ('room_occupancy_discrepancies', ARRAY['id', 'tenant_id', 'room_id', 'status'])
  ) AS t(table_name, columns);
$function$;

-- Every way the worker identity could exceed the contract. Empty = compliant. Checks role attributes and membership,
-- EXECUTE on any public definer, harness or shared domain-write function outside the wrappers, the wrappers'
-- grantees, every table privilege, and every readable column.
CREATE OR REPLACE FUNCTION public.agent_worker_privilege_violations()
RETURNS TABLE (object_name text, violation text) LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT x.object_name, x.violation FROM (
    SELECT 'role:agent_worker' AS object_name, 'missing' AS violation
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')
    UNION ALL
    SELECT 'role:agent_worker', 'privileged_attribute' FROM pg_catalog.pg_roles
     WHERE rolname = 'agent_worker'
       AND (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolreplication OR rolbypassrls)
    UNION ALL
    SELECT 'role:' || r.rolname, 'membership' FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
     WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'agent_worker')
    UNION ALL
    -- Invoker functions outside this set run with agent_worker's own read-only rights and are not listed.
    SELECT 'function:' || p.oid::regprocedure::text, 'executable_by_worker'
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
       AND (p.prosecdef OR p.proname LIKE 'agent%' OR p.proname LIKE 'billing%'
            OR p.proname IN ('work_order_assign_apply', 'publish_assignment_batch'))
       AND p.proname NOT LIKE 'agent\_worker\_rpc\_\_%'
       AND p.proname <> 'agent__worker_credential_ok'
       AND pg_catalog.has_function_privilege('agent_worker', p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'function:public.agent_worker_rpc__' || a.rpc, 'wrapper_missing'
      FROM public.agent__worker_allowed_rpcs() a(rpc)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = 'agent_worker_rpc__' || a.rpc AND p.prosecdef
                          AND p.proconfig @> ARRAY['search_path=""'])
    UNION ALL
    SELECT 'function:' || p.oid::regprocedure::text, 'wrapper_not_reviewed'
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'agent\_worker\_rpc\_\_%'
       AND substr(p.proname, 19) NOT IN (SELECT a.rpc FROM public.agent__worker_allowed_rpcs() a(rpc))
    UNION ALL
    SELECT 'function:' || p.oid::regprocedure::text, 'wrapper_executable_by_' || r.role_name
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) r(role_name)
     WHERE n.nspname = 'public' AND p.proname LIKE 'agent\_worker\_rpc\_\_%'
       AND pg_catalog.has_function_privilege(r.role_name, p.oid, 'EXECUTE')
    UNION ALL
    SELECT 'table:' || c.oid::regclass::text, 'table_privilege:' || pr.privilege
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(privilege)
     WHERE n.nspname IN ('public', 'graphql_public') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND pg_catalog.has_table_privilege('agent_worker', c.oid, pr.privilege)
    UNION ALL
    SELECT 'table:' || c.oid::regclass::text, 'column_privilege:' || pr.privilege
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) pr(privilege)
     WHERE n.nspname IN ('public', 'graphql_public') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND pg_catalog.has_any_column_privilege('agent_worker', c.oid, pr.privilege)
    UNION ALL
    SELECT 'column:' || c.relname || '.' || a.attname, 'unreviewed_read'
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege('agent_worker', c.oid, a.attnum, 'SELECT')
       AND (c.relname::text, a.attname::text) NOT IN (SELECT w.table_name, w.column_name
                                                       FROM public.agent__worker_read_columns() w)
  ) x
  ORDER BY 1, 2;
$function$;

REVOKE ALL ON FUNCTION public.agent__worker_allowed_rpcs() FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent__worker_read_columns() FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_worker_privilege_violations() FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent__worker_allowed_rpcs() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__worker_read_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_privilege_violations() TO service_role;

DO $verify$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(v.object_name || ':' || v.violation, ', ') INTO v_left FROM public.agent_worker_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent_worker exceeds its reviewed privileges: %', v_left USING ERRCODE = '42501';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';
