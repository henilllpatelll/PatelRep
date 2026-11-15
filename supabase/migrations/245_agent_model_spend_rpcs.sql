-- =============================================================================
-- Migration 245: Agent Harness H3 -- provider-spend ledger RPCs
-- =============================================================================
-- Additive only (new functions). Every function is SECURITY INVOKER with an empty search_path, executable only by
-- service_role, and is ONE transaction. Monetary values cross the API boundary as TEXT (exact decimals, never JSON
-- floats).
--
-- Attempt lifecycle (agent_model_attempt_transition_allowed, migration 244):
--   reserve  -> 'reserved'   fenced run lock, idempotent replay, switch/controls/entitlement/run state, exact schedule,
--                            database exposure <= presented exposure, required policies, uncertain cap, counters locked
--                            in the fixed order platform -> provider -> hotel -> agent -> run -> step, all checked BEFORE
--                            any increment. A denial changes no counter; it writes one reservation_denied event.
--   dispatch -> 'dispatched' re-checks lease, cancel/pause, deadline, switch and controls IMMEDIATELY before the network
--                            call; on any refusal the attempt is released in the same transaction. The worker contacts
--                            the provider only after this commits.
--   settle   -> 'settled' (actual cost; overrun recorded in full and flagged) | 'released' (provider rejected, no charge)
--               | 'uncertain' (outcome unknown; exposure kept) | 'unreconciled' (response but cost unknown; exposure kept)
--   reconcile (operator, tenant-scoped, evidence code) is the ONLY way out of uncertain/unreconciled.
--   recover  releases reserved-but-never-dispatched attempts of dead workers and marks unsettled dispatched attempts
--            uncertain -- it never releases a dispatched attempt.
--
-- Lock order: run row (agent__owned_run) -> attempt row -> counters (fixed scope order). No function takes these in
-- another order, so reservations, settlements and recovery cannot deadlock each other.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agent__model_period(p_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT (date_trunc('month', p_at AT TIME ZONE 'UTC'))::date;
$function$;

-- Mirrors provider_pricing.max_exposure: dearest input category, tier reached by the MAXIMUM prompt, rounded up to 1e-8.
CREATE OR REPLACE FUNCTION public.agent__model_max_exposure(
  p_schedule public.agent_model_price_schedules, p_max_input integer, p_max_output integer
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE
  v_long boolean := p_schedule.long_context_threshold IS NOT NULL AND p_max_input > p_schedule.long_context_threshold;
  v_in   numeric;
  v_out  numeric;
BEGIN
  IF p_max_input IS NULL OR p_max_output IS NULL OR p_max_input < 0 OR p_max_output < 1 THEN
    RETURN NULL;
  END IF;
  IF v_long THEN
    v_in := greatest(p_schedule.long_input_per_mtok, coalesce(p_schedule.long_cache_read_per_mtok, 0),
                     coalesce(p_schedule.long_cache_write_short_per_mtok, 0),
                     coalesce(p_schedule.long_cache_write_long_per_mtok, 0));
    v_out := p_schedule.long_output_per_mtok;
  ELSE
    v_in := greatest(p_schedule.input_per_mtok, coalesce(p_schedule.cache_read_per_mtok, 0),
                     coalesce(p_schedule.cache_write_short_per_mtok, 0), coalesce(p_schedule.cache_write_long_per_mtok, 0));
    v_out := p_schedule.output_per_mtok;
  END IF;
  -- tokens * rate is USD * 1e6; * 100 is units of 1e-8 USD; ceil then scale back (exact numeric arithmetic).
  RETURN ceil((p_max_input::numeric * v_in + p_max_output::numeric * v_out) * 100) / 100000000;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__model_attempt_json(p_a public.agent_model_attempts)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_a.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p_a.id, 'tenant_id', p_a.tenant_id, 'run_id', p_a.run_id, 'step_id', p_a.step_id,
    'logical_call_key', p_a.logical_call_key, 'attempt_number', p_a.attempt_number, 'provider', p_a.provider,
    'requested_model', p_a.requested_model, 'schedule_version', p_a.schedule_version,
    'max_input_tokens', p_a.max_input_tokens, 'max_output_tokens', p_a.max_output_tokens,
    'period_start', p_a.period_start, 'fencing_token', p_a.fencing_token, 'state', p_a.state,
    'reserved_usd', p_a.reserved_usd::text, 'settled_usd', p_a.settled_usd::text, 'overrun_usd', p_a.overrun_usd::text,
    'reported_model', p_a.reported_model, 'provider_request_id', p_a.provider_request_id,
    'provider_response_id', p_a.provider_response_id, 'usage_status', p_a.usage_status, 'usage', p_a.usage,
    'cost_status', p_a.cost_status, 'cost_cause', p_a.cost_cause, 'cost_tier', p_a.cost_tier,
    'error_code', p_a.error_code, 'reconciliation_required', p_a.reconciliation_required,
    'reserved_at', p_a.reserved_at, 'dispatched_at', p_a.dispatched_at, 'finished_at', p_a.finished_at,
    'reconciled_by', p_a.reconciled_by, 'reconciled_at', p_a.reconciled_at) END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__model_event(
  p_tenant_id uuid, p_run_id uuid, p_attempt_id uuid, p_event_type text, p_amount numeric, p_reason text,
  p_actor_kind text, p_actor_ref text, p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  INSERT INTO public.agent_model_spend_events (tenant_id, run_id, attempt_id, event_type, amount_usd, reason_code,
                                               actor_kind, actor_ref, detail)
  VALUES (p_tenant_id, p_run_id, p_attempt_id, p_event_type, p_amount, p_reason, p_actor_kind,
          left(p_actor_ref, 100), COALESCE(p_detail, '{}'::jsonb));
$function$;

-- Create-if-missing then lock one counter row.
CREATE OR REPLACE FUNCTION public.agent__model_counter(p_scope text, p_key text, p_tenant_id uuid, p_period date)
RETURNS public.agent_model_budget_counters LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_model_budget_counters%ROWTYPE;
BEGIN
  INSERT INTO public.agent_model_budget_counters (scope, scope_key, tenant_id, period_start)
  VALUES (p_scope, p_key, p_tenant_id, p_period)
  ON CONFLICT (scope, scope_key, period_start) DO NOTHING;
  SELECT * INTO v_row FROM public.agent_model_budget_counters
   WHERE scope = p_scope AND scope_key = p_key AND period_start = p_period FOR UPDATE;
  RETURN v_row;
END;
$function$;

-- The six counter keys of an attempt, in the fixed lock order.
CREATE OR REPLACE FUNCTION public.agent__model_counter_keys(
  p_tenant_id uuid, p_provider text, p_agent_id text, p_agent_version integer, p_run_id uuid, p_step_id uuid,
  p_period date
)
RETURNS TABLE (ord integer, scope text, scope_key text, tenant_id uuid, period_start date)
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  VALUES
    (1, 'platform', 'platform', NULL::uuid, p_period),
    (2, 'provider', p_provider, NULL::uuid, p_period),
    (3, 'hotel', p_tenant_id::text, p_tenant_id, p_period),
    (4, 'agent', p_tenant_id::text || ':' || p_agent_id || ':' || p_agent_version::text, p_tenant_id, p_period),
    (5, 'run', p_run_id::text, p_tenant_id, DATE '1970-01-01'),
    (6, 'step', p_step_id::text, p_tenant_id, DATE '1970-01-01');
$function$;

-- Apply a reserved/committed delta to every counter of an attempt, locking in the fixed order.
CREATE OR REPLACE FUNCTION public.agent__model_counters_apply(
  p_a public.agent_model_attempts, p_reserved_delta numeric, p_committed_delta numeric
)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  k record;
  v_row public.agent_model_budget_counters%ROWTYPE;
BEGIN
  FOR k IN SELECT * FROM public.agent__model_counter_keys(p_a.tenant_id, p_a.provider, p_a.agent_id, p_a.agent_version,
                                                          p_a.run_id, p_a.step_id, p_a.period_start) ORDER BY ord LOOP
    v_row := public.agent__model_counter(k.scope, k.scope_key, k.tenant_id, k.period_start);
    UPDATE public.agent_model_budget_counters
       SET reserved_usd = reserved_usd + p_reserved_delta, committed_usd = committed_usd + p_committed_delta
     WHERE id = v_row.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__model_block_reason(p_run public.agent_runs)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_block text;
BEGIN
  IF p_run.agent_id IS DISTINCT FROM 'harness.orchestrator' OR p_run.agent_version IS DISTINCT FROM 1 THEN
    RETURN 'agent_not_metered';
  END IF;
  IF p_run.state <> 'running' OR p_run.cancel_requested_at IS NOT NULL THEN
    RETURN 'run_cancel_requested';
  END IF;
  IF p_run.pause_requested_at IS NOT NULL THEN
    RETURN 'run_pause_requested';
  END IF;
  IF p_run.deadline_at <= now() THEN
    RETURN 'deadline_exceeded';
  END IF;
  IF NOT COALESCE((SELECT enabled FROM public.agent_model_enablement WHERE id = 1), false) THEN
    RETURN 'paid_calls_disabled';
  END IF;
  v_block := public.agent__control_block_reason(p_run.tenant_id, p_run.agent_id);
  IF v_block IS NOT NULL THEN
    RETURN v_block;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags
                  WHERE tenant_id = p_run.tenant_id AND feature_key = 'ai_agents' AND enabled) THEN
    RETURN 'tenant_capability_disabled';
  END IF;
  RETURN NULL;
END;
$function$;

-- Release an open attempt (no charge): its whole reservation leaves every counter.
CREATE OR REPLACE FUNCTION public.agent__model_release(
  p_a public.agent_model_attempts, p_reason text, p_actor_kind text, p_actor_ref text
)
RETURNS public.agent_model_attempts LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_a public.agent_model_attempts%ROWTYPE;
BEGIN
  UPDATE public.agent_model_attempts
     SET state = 'released', settled_usd = 0, finished_at = now(), error_code = COALESCE(p_reason, error_code),
         reconciliation_required = false
   WHERE id = p_a.id
  RETURNING * INTO v_a;
  PERFORM public.agent__model_counters_apply(v_a, -v_a.reserved_usd, 0);
  PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'released', v_a.reserved_usd, p_reason,
                                    p_actor_kind, p_actor_ref);
  RETURN v_a;
END;
$function$;

-- Move an open attempt to settled at an actual cost. Overruns are recorded in full, never discarded.
CREATE OR REPLACE FUNCTION public.agent__model_settle_cost(
  p_a public.agent_model_attempts, p_cost numeric, p_actor_kind text, p_actor_ref text, p_flag_overrun boolean
)
RETURNS public.agent_model_attempts LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_a       public.agent_model_attempts%ROWTYPE;
  v_overrun numeric := CASE WHEN p_cost > p_a.reserved_usd THEN p_cost - p_a.reserved_usd END;
BEGIN
  UPDATE public.agent_model_attempts
     SET state = 'settled', settled_usd = p_cost, overrun_usd = v_overrun, finished_at = now(),
         reconciliation_required = (v_overrun IS NOT NULL AND p_flag_overrun)
   WHERE id = p_a.id
  RETURNING * INTO v_a;
  PERFORM public.agent__model_counters_apply(v_a, -v_a.reserved_usd, p_cost);
  PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'settled', p_cost, NULL, p_actor_kind, p_actor_ref);
  IF v_overrun IS NOT NULL THEN
    PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'overrun_detected', v_overrun,
                                      'actual_exceeded_reservation', p_actor_kind, p_actor_ref);
  END IF;
  RETURN v_a;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: reserve (fenced)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempt_reserve(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_step_id uuid, p_logical_call_key text,
  p_attempt_number integer, p_provider text, p_model text, p_schedule_version text, p_max_input_tokens integer,
  p_max_output_tokens integer, p_exposure_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run      public.agent_runs%ROWTYPE;
  v_existing public.agent_model_attempts%ROWTYPE;
  v_sched    public.agent_model_price_schedules%ROWTYPE;
  v_platform public.agent_model_budget_policies%ROWTYPE;
  v_provider public.agent_model_budget_policies%ROWTYPE;
  v_hotel    public.agent_model_budget_policies%ROWTYPE;
  v_agent    public.agent_model_budget_policies%ROWTYPE;
  v_attempt  public.agent_model_attempts%ROWTYPE;
  v_counter  public.agent_model_budget_counters%ROWTYPE;
  v_ids      bigint[] := '{}';
  v_period   date := public.agent__model_period(now());
  v_reason   text;
  v_db_exp   numeric;
  v_limit    numeric;
  k          record;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;

  SELECT * INTO v_existing FROM public.agent_model_attempts
   WHERE tenant_id = v_run.tenant_id AND logical_call_key = p_logical_call_key AND attempt_number = p_attempt_number;
  IF FOUND THEN
    IF v_existing.run_id <> v_run.id OR v_existing.step_id IS DISTINCT FROM p_step_id
       OR v_existing.provider IS DISTINCT FROM p_provider OR v_existing.requested_model IS DISTINCT FROM p_model
       OR v_existing.schedule_version IS DISTINCT FROM p_schedule_version
       OR v_existing.max_input_tokens IS DISTINCT FROM p_max_input_tokens
       OR v_existing.max_output_tokens IS DISTINCT FROM p_max_output_tokens
       OR v_existing.reserved_usd IS DISTINCT FROM p_exposure_usd THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    END IF;
    PERFORM public.agent__model_event(v_run.tenant_id, v_run.id, v_existing.id, 'reservation_replayed', NULL, NULL,
                                      'worker', p_worker);
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'attempt', public.agent__model_attempt_json(v_existing));
  END IF;

  v_reason := public.agent__model_block_reason(v_run);
  IF v_reason IS NULL AND NOT EXISTS (SELECT 1 FROM public.agent_run_steps
                                        WHERE id = p_step_id AND run_id = v_run.id AND state = 'running') THEN
    v_reason := 'step_not_running';
  END IF;
  IF v_reason IS NULL AND (p_attempt_number IS NULL OR p_attempt_number NOT BETWEEN 1 AND 20
                           OR p_max_input_tokens IS NULL OR p_max_input_tokens < 1
                           OR p_max_output_tokens IS NULL OR p_max_output_tokens < 1
                           OR p_exposure_usd IS NULL OR p_exposure_usd <= 0 OR p_exposure_usd <> round(p_exposure_usd, 8)
                           OR p_logical_call_key IS NULL OR p_logical_call_key !~ '^[a-z0-9][a-z0-9:._-]{0,199}$') THEN
    v_reason := 'invalid_request';
  END IF;
  IF v_reason IS NULL THEN
    SELECT * INTO v_sched FROM public.agent_model_price_schedules
     WHERE provider = p_provider AND model = p_model AND schedule_version = p_schedule_version
       AND processing_mode = 'standard' AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now());
    IF NOT FOUND THEN
      v_reason := 'price_schedule_unavailable';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_db_exp := public.agent__model_max_exposure(v_sched, p_max_input_tokens, p_max_output_tokens);
    IF v_db_exp IS NULL OR p_exposure_usd < v_db_exp THEN
      v_reason := 'exposure_understated';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    SELECT * INTO v_platform FROM public.agent_model_budget_policies WHERE scope = 'platform' AND retired_at IS NULL;
    SELECT * INTO v_provider FROM public.agent_model_budget_policies
     WHERE scope = 'provider' AND provider = p_provider AND retired_at IS NULL;
    SELECT * INTO v_hotel FROM public.agent_model_budget_policies
     WHERE scope = 'hotel' AND tenant_id = v_run.tenant_id AND retired_at IS NULL;
    SELECT * INTO v_agent FROM public.agent_model_budget_policies
     WHERE scope = 'agent' AND tenant_id = v_run.tenant_id AND agent_id = v_run.agent_id
       AND agent_version = v_run.agent_version AND retired_at IS NULL;
    IF v_platform.id IS NULL THEN
      v_reason := 'budget_policy_missing_platform';
    ELSIF v_hotel.id IS NULL THEN
      v_reason := 'budget_policy_missing_hotel';
    ELSIF v_agent.id IS NULL THEN
      v_reason := 'budget_policy_missing_agent';
    ELSIF p_exposure_usd > v_agent.call_limit_usd THEN
      v_reason := 'call_budget_exceeded';
    ELSIF (SELECT count(*) FROM public.agent_model_attempts
            WHERE run_id = v_run.id AND tenant_id = v_run.tenant_id AND state IN ('uncertain', 'unreconciled'))
          >= v_agent.max_uncertain_per_run THEN
      v_reason := 'uncertain_limit_reached';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    FOR k IN SELECT * FROM public.agent__model_counter_keys(v_run.tenant_id, p_provider, v_run.agent_id,
                                                            v_run.agent_version, v_run.id, p_step_id, v_period)
             ORDER BY ord LOOP
      v_counter := public.agent__model_counter(k.scope, k.scope_key, k.tenant_id, k.period_start);
      v_ids := v_ids || v_counter.id;
      v_limit := CASE k.scope
        WHEN 'platform' THEN v_platform.period_limit_usd WHEN 'provider' THEN v_provider.period_limit_usd
        WHEN 'hotel' THEN v_hotel.period_limit_usd WHEN 'agent' THEN v_agent.period_limit_usd
        WHEN 'run' THEN v_agent.run_limit_usd WHEN 'step' THEN v_agent.step_limit_usd END;
      IF v_limit IS NOT NULL AND v_counter.reserved_usd + v_counter.committed_usd + p_exposure_usd > v_limit THEN
        v_reason := k.scope || '_budget_exceeded';
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.agent__model_event(v_run.tenant_id, v_run.id, NULL, 'reservation_denied', p_exposure_usd,
                                      v_reason, 'worker', p_worker,
                                      jsonb_build_object('provider', left(p_provider, 20), 'model', left(p_model, 100)));
    RETURN jsonb_build_object('ok', false, 'denied', true, 'reason', v_reason);
  END IF;

  UPDATE public.agent_model_budget_counters SET reserved_usd = reserved_usd + p_exposure_usd WHERE id = ANY (v_ids);
  INSERT INTO public.agent_model_attempts (
    tenant_id, run_id, step_id, agent_id, agent_version, logical_call_key, attempt_number, provider, requested_model,
    schedule_id, schedule_version, max_input_tokens, max_output_tokens, period_start, fencing_token, worker_id,
    reserved_usd)
  VALUES (
    v_run.tenant_id, v_run.id, p_step_id, v_run.agent_id, v_run.agent_version, p_logical_call_key, p_attempt_number,
    p_provider, p_model, v_sched.id, v_sched.schedule_version, p_max_input_tokens, p_max_output_tokens, v_period,
    p_fencing_token, p_worker, p_exposure_usd)
  RETURNING * INTO v_attempt;
  PERFORM public.agent__model_event(v_run.tenant_id, v_run.id, v_attempt.id, 'reserved', p_exposure_usd, NULL,
                                    'worker', p_worker,
                                    jsonb_build_object('policies', jsonb_build_object(
                                      'platform', v_platform.policy_version, 'provider', v_provider.policy_version,
                                      'hotel', v_hotel.policy_version, 'agent', v_agent.policy_version)));
  RETURN jsonb_build_object('ok', true, 'created', true, 'attempt', public.agent__model_attempt_json(v_attempt));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: dispatch marker (fenced). Refusal releases the attempt in the same transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempt_dispatch(
  p_attempt_id uuid, p_run_id uuid, p_fencing_token bigint, p_worker text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run    public.agent_runs%ROWTYPE;
  v_a      public.agent_model_attempts%ROWTYPE;
  v_reason text;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id AND run_id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_a.fencing_token <> p_fencing_token OR v_a.worker_id <> p_worker THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_a.state = 'dispatched' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'attempt', public.agent__model_attempt_json(v_a));
  END IF;
  IF v_a.state <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_reserved', 'state', v_a.state);
  END IF;
  IF v_run.id IS NULL THEN
    v_reason := 'lease_lost';
  ELSE
    v_reason := public.agent__model_block_reason(v_run);
  END IF;
  IF v_reason IS NULL AND NOT EXISTS (SELECT 1 FROM public.agent_run_steps
                                        WHERE id = v_a.step_id AND run_id = v_a.run_id AND state = 'running') THEN
    v_reason := 'step_not_running';
  END IF;
  IF v_reason IS NOT NULL THEN
    v_a := public.agent__model_release(v_a, v_reason, 'worker', p_worker);
    PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'dispatch_refused', NULL, v_reason,
                                      'worker', p_worker);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason, 'released', true,
                              'attempt', public.agent__model_attempt_json(v_a));
  END IF;
  UPDATE public.agent_model_attempts SET state = 'dispatched', dispatched_at = now() WHERE id = v_a.id
  RETURNING * INTO v_a;
  PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'dispatched', NULL, NULL, 'worker', p_worker);
  RETURN jsonb_build_object('ok', true, 'attempt', public.agent__model_attempt_json(v_a));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: release a reserved attempt that was never dispatched (local failure before the network call)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempt_release(p_attempt_id uuid, p_fencing_token bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a public.agent_model_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_a.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_a.state = 'released' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'attempt', public.agent__model_attempt_json(v_a));
  END IF;
  IF v_a.state <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_reserved', 'state', v_a.state);
  END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    p_reason := 'released_before_dispatch';
  END IF;
  v_a := public.agent__model_release(v_a, p_reason, 'worker', v_a.worker_id);
  RETURN jsonb_build_object('ok', true, 'attempt', public.agent__model_attempt_json(v_a));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Worker: settle a dispatched attempt. Bound to the attempt's fencing token, NOT the lease: money already spent by a
-- worker that lost its lease must still be recorded.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempt_settle(
  p_attempt_id uuid, p_fencing_token bigint, p_outcome text, p_cost_usd numeric, p_usage_status text, p_usage jsonb,
  p_cost_status text, p_cost_cause text, p_cost_tier text, p_reported_model text, p_provider_request_id text,
  p_provider_response_id text, p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a public.agent_model_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_a.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_a.state IN ('settled', 'released', 'unreconciled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_settled', 'attempt', public.agent__model_attempt_json(v_a));
  END IF;
  IF v_a.state = 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_dispatched');
  END IF;
  -- From 'uncertain' only real provider evidence (a response) may settle it; a release or another "uncertain" may not.
  IF v_a.state = 'uncertain' AND p_outcome NOT IN ('settled', 'unreconciled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_settled', 'attempt', public.agent__model_attempt_json(v_a));
  END IF;
  IF p_outcome NOT IN ('settled', 'released', 'uncertain', 'unreconciled')
     OR (p_outcome = 'settled' AND (p_cost_usd IS NULL OR p_cost_usd < 0 OR p_cost_usd <> round(p_cost_usd, 8)
                                    OR p_usage_status IS DISTINCT FROM 'reported' OR p_cost_status IS DISTINCT FROM 'costed'))
     OR (p_outcome <> 'settled' AND p_cost_usd IS NOT NULL)
     OR (p_outcome = 'unreconciled' AND p_cost_status IS DISTINCT FROM 'unreconciled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  END IF;

  UPDATE public.agent_model_attempts
     SET usage_status = p_usage_status, usage = p_usage, cost_status = p_cost_status, cost_cause = p_cost_cause,
         cost_tier = p_cost_tier, reported_model = COALESCE(p_reported_model, reported_model),
         provider_request_id = COALESCE(p_provider_request_id, provider_request_id),
         provider_response_id = COALESCE(p_provider_response_id, provider_response_id),
         error_code = COALESCE(p_error_code, error_code),
         state = CASE WHEN p_outcome IN ('uncertain', 'unreconciled') THEN p_outcome ELSE state END,
         reconciliation_required = CASE WHEN p_outcome IN ('uncertain', 'unreconciled') THEN true
                                        ELSE reconciliation_required END
   WHERE id = v_a.id
  RETURNING * INTO v_a;

  IF p_outcome = 'settled' THEN
    v_a := public.agent__model_settle_cost(v_a, p_cost_usd, 'worker', v_a.worker_id, true);
  ELSIF p_outcome = 'released' THEN
    v_a := public.agent__model_release(v_a, COALESCE(p_error_code, 'provider_rejected_no_charge'), 'worker',
                                       v_a.worker_id);
  ELSE
    PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, p_outcome, v_a.reserved_usd,
                                      COALESCE(p_cost_cause, p_error_code), 'worker', v_a.worker_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'attempt', public.agent__model_attempt_json(v_a));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Operator: reconcile an uncertain / unreconciled attempt, or acknowledge a settled overrun (tenant-scoped)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempt_reconcile(
  p_tenant_id uuid, p_attempt_id uuid, p_resolution text, p_actual_usd numeric, p_operator text, p_evidence_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a public.agent_model_attempts%ROWTYPE;
BEGIN
  IF p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$'
     OR p_evidence_code IS NULL OR p_evidence_code !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_and_evidence_required');
  END IF;
  SELECT * INTO v_a FROM public.agent_model_attempts WHERE id = p_attempt_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_a.state IN ('uncertain', 'unreconciled') AND p_resolution = 'settled' THEN
    IF p_actual_usd IS NULL OR p_actual_usd < 0 OR p_actual_usd <> round(p_actual_usd, 8) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
    END IF;
    v_a := public.agent__model_settle_cost(v_a, p_actual_usd, 'operator', p_operator, false);
  ELSIF v_a.state IN ('uncertain', 'unreconciled') AND p_resolution = 'released' AND p_actual_usd IS NULL THEN
    v_a := public.agent__model_release(v_a, 'reconciled_no_charge', 'operator', p_operator);
  ELSIF v_a.state = 'settled' AND v_a.reconciliation_required AND p_resolution = 'acknowledged'
        AND p_actual_usd IS NULL THEN
    NULL;  -- the overrun stays recorded; only the flag is cleared below
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'not_reconcilable', 'state', v_a.state);
  END IF;
  UPDATE public.agent_model_attempts
     SET reconciliation_required = false, reconciled_by = p_operator, reconciled_at = now(),
         reconciliation_evidence = p_evidence_code
   WHERE id = v_a.id AND reconciled_by IS NULL
  RETURNING * INTO v_a;
  PERFORM public.agent__model_event(p_tenant_id, v_a.run_id, v_a.id, 'reconciled', v_a.settled_usd, p_evidence_code,
                                    'operator', p_operator, jsonb_build_object('resolution', p_resolution));
  RETURN jsonb_build_object('ok', true, 'attempt', public.agent__model_attempt_json(v_a));
END;
$function$;

-- -----------------------------------------------------------------------------
-- Recovery sweep (bounded; never releases a dispatched attempt)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempts_recover(p_stale_seconds integer DEFAULT 900,
                                                               p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_a        public.agent_model_attempts%ROWTYPE;
  v_run      public.agent_runs%ROWTYPE;
  v_released integer := 0;
  v_uncertain integer := 0;
  -- The threshold is only a courtesy delay: an attempt whose worker still holds a live lease is always skipped, a
  -- reserved attempt is safe to release (never dispatched) and a dispatched one only becomes uncertain.
  v_stale    interval := make_interval(secs => greatest(COALESCE(p_stale_seconds, 900), 0));
  v_limit    integer := least(greatest(COALESCE(p_limit, 100), 1), 1000);
BEGIN
  FOR v_a IN SELECT * FROM public.agent_model_attempts
              WHERE state IN ('reserved', 'dispatched') AND reserved_at < now() - v_stale
              ORDER BY reserved_at LIMIT v_limit FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO v_run FROM public.agent_runs WHERE id = v_a.run_id;
    -- The worker that owns this attempt still holds a live lease under the same token: leave it alone.
    CONTINUE WHEN v_run.fencing_token = v_a.fencing_token AND v_run.lease_owner = v_a.worker_id
                  AND v_run.lease_expires_at > now();
    IF v_a.state = 'reserved' THEN
      -- The dispatch marker never committed, so the provider was never contacted.
      PERFORM public.agent__model_release(v_a, 'recovered_never_dispatched', 'recovery', 'agent_model_attempts_recover');
      v_released := v_released + 1;
    ELSE
      UPDATE public.agent_model_attempts
         SET state = 'uncertain', reconciliation_required = true, error_code = COALESCE(error_code, 'recovered_unsettled')
       WHERE id = v_a.id;
      PERFORM public.agent__model_event(v_a.tenant_id, v_a.run_id, v_a.id, 'recovered', v_a.reserved_usd,
                                        'recovered_unsettled', 'recovery', 'agent_model_attempts_recover');
      v_uncertain := v_uncertain + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('released', v_released, 'uncertain', v_uncertain);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Operator: budget policies and the paid-call switch
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_budget_policy_set(
  p_scope text, p_tenant_id uuid, p_provider text, p_agent_id text, p_agent_version integer,
  p_period_limit_usd numeric, p_run_limit_usd numeric, p_step_limit_usd numeric, p_call_limit_usd numeric,
  p_max_uncertain_per_run integer, p_operator text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_next integer;
  v_row  public.agent_model_budget_policies%ROWTYPE;
BEGIN
  IF p_scope NOT IN ('platform', 'provider', 'hotel', 'agent') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_policy');
  END IF;
  IF p_operator IS NULL OR p_operator !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_required');
  END IF;
  IF p_tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tenant_not_found');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'agent_model_policy', p_scope, p_tenant_id, p_provider, p_agent_id, p_agent_version), 0));
  SELECT COALESCE(max(policy_version), 0) + 1 INTO v_next FROM public.agent_model_budget_policies
   WHERE scope = p_scope AND tenant_id IS NOT DISTINCT FROM p_tenant_id AND provider IS NOT DISTINCT FROM p_provider
     AND agent_id IS NOT DISTINCT FROM p_agent_id AND agent_version IS NOT DISTINCT FROM p_agent_version;
  BEGIN
    UPDATE public.agent_model_budget_policies SET retired_at = now(), retired_by = p_operator
     WHERE scope = p_scope AND tenant_id IS NOT DISTINCT FROM p_tenant_id AND provider IS NOT DISTINCT FROM p_provider
       AND agent_id IS NOT DISTINCT FROM p_agent_id AND agent_version IS NOT DISTINCT FROM p_agent_version
       AND retired_at IS NULL;
    INSERT INTO public.agent_model_budget_policies (
      scope, tenant_id, provider, agent_id, agent_version, policy_version, period_limit_usd, run_limit_usd,
      step_limit_usd, call_limit_usd, max_uncertain_per_run, reason_code, created_by)
    VALUES (p_scope, p_tenant_id, p_provider, p_agent_id, p_agent_version, v_next, p_period_limit_usd, p_run_limit_usd,
            p_step_limit_usd, p_call_limit_usd, p_max_uncertain_per_run, p_reason, p_operator)
    RETURNING * INTO v_row;
  EXCEPTION WHEN check_violation OR not_null_violation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_policy');
  END;
  RETURN jsonb_build_object('ok', true, 'policy_id', v_row.id, 'policy_version', v_row.policy_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_model_enablement_set(p_enabled boolean, p_updated_by text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_enabled IS NULL OR p_updated_by IS NULL OR p_updated_by !~ '^[A-Za-z0-9._:@-]{1,100}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  UPDATE public.agent_model_enablement
     SET enabled = p_enabled, updated_by = p_updated_by, updated_at = now(),
         reason_code = CASE WHEN p_reason ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason END
   WHERE id = 1;
  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END;
$function$;

-- -----------------------------------------------------------------------------
-- Read-only: tenant-scoped attempts of a run; platform diagnostics
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_model_attempts_for_run(p_tenant_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__model_attempt_json(a) ORDER BY a.reserved_at, a.attempt_number), '[]'::jsonb)
    FROM public.agent_model_attempts a
   WHERE a.tenant_id = p_tenant_id AND a.run_id = p_run_id;
$function$;

CREATE OR REPLACE FUNCTION public.agent_model_spend_diagnostics(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'paid_calls_enabled', COALESCE((SELECT enabled FROM public.agent_model_enablement WHERE id = 1), false),
    'open_exposure_by_state', COALESCE((
      SELECT jsonb_object_agg(state, total::text) FROM (
        SELECT state, sum(reserved_usd) AS total FROM public.agent_model_attempts
         WHERE state IN ('reserved', 'dispatched', 'uncertain', 'unreconciled') GROUP BY state) s), '{}'::jsonb),
    'reconciliation_required', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attempt_id', a.id, 'tenant_id', a.tenant_id, 'run_id', a.run_id, 'state', a.state,
        'reserved_usd', a.reserved_usd::text, 'settled_usd', a.settled_usd::text, 'overrun_usd', a.overrun_usd::text,
        'error_code', a.error_code, 'cost_cause', a.cost_cause, 'reserved_at', a.reserved_at) ORDER BY a.reserved_at)
        FROM (SELECT * FROM public.agent_model_attempts WHERE reconciliation_required
               ORDER BY reserved_at LIMIT least(greatest(COALESCE(p_limit, 20), 1), 200)) a), '[]'::jsonb),
    'platform_counters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope', c.scope, 'scope_key', c.scope_key, 'period_start', c.period_start,
                                          'reserved_usd', c.reserved_usd::text, 'committed_usd', c.committed_usd::text)
                       ORDER BY c.scope, c.scope_key)
        FROM public.agent_model_budget_counters c
       WHERE c.scope IN ('platform', 'provider') AND c.period_start = public.agent__model_period(now())), '[]'::jsonb));
$function$;

-- -----------------------------------------------------------------------------
-- Privileges: service role only
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__model_period(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_max_exposure(public.agent_model_price_schedules, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_attempt_json(public.agent_model_attempts) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_event(uuid, uuid, uuid, text, numeric, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_counter(text, text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_counter_keys(uuid, text, text, integer, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_counters_apply(public.agent_model_attempts, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_block_reason(public.agent_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_release(public.agent_model_attempts, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__model_settle_cost(public.agent_model_attempts, numeric, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_reserve(uuid, bigint, text, uuid, text, integer, text, text, text, integer, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_dispatch(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_release(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_settle(uuid, bigint, text, numeric, text, jsonb, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_reconcile(uuid, uuid, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempts_recover(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_budget_policy_set(text, uuid, text, text, integer, numeric, numeric, numeric, numeric, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_enablement_set(boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempts_for_run(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_spend_diagnostics(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent__model_period(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_max_exposure(public.agent_model_price_schedules, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_attempt_json(public.agent_model_attempts) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_event(uuid, uuid, uuid, text, numeric, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_counter(text, text, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_counter_keys(uuid, text, text, integer, uuid, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_counters_apply(public.agent_model_attempts, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_block_reason(public.agent_runs) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_release(public.agent_model_attempts, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__model_settle_cost(public.agent_model_attempts, numeric, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_reserve(uuid, bigint, text, uuid, text, integer, text, text, text, integer, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_dispatch(uuid, uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_release(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_settle(uuid, bigint, text, numeric, text, jsonb, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_reconcile(uuid, uuid, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempts_recover(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_budget_policy_set(text, uuid, text, text, integer, numeric, numeric, numeric, numeric, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_enablement_set(boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_attempts_for_run(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_model_spend_diagnostics(integer) TO service_role;
