-- =============================================================================
-- Migration 240: Agent Harness H1 -- tenant-scoped operations, recovery and diagnostics RPCs
-- =============================================================================
-- Additive only: new functions over the migration 238 tables. SECURITY INVOKER, empty search_path, revoked from
-- PUBLIC/anon/authenticated, granted only to service_role.
--
-- Every tenant-scoped function takes p_tenant_id and matches the run on (id, tenant_id) inside the database, so a
-- caller holding another hotel's run id learns only 'not_found'. Callers derive p_tenant_id from trusted server context
-- (a verified CurrentUser or an operator), never from a request body.
--
--   agent_run_request_cancel / agent_run_request_pause / agent_run_resume   persistent, idempotent control requests
--   agent_run_get / agent_run_events_page                                     sanitized reads (no digest, no payloads)
--   agent_runs_recover                                                        bounded, idempotent crash-recovery sweep
--   agent_execution_diagnostics                                               platform operations view (runbook)
--   agent_runtime_control_set                                                 platform/hotel/agent pause, cost stop
--   agent_worker_heartbeat                                                    worker liveness upsert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agent_run_request_cancel(p_tenant_id uuid, p_run_id uuid, p_requested_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_by  text := CASE WHEN p_requested_by ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_requested_by END;
BEGIN
  IF v_by IS NULL THEN
    RAISE EXCEPTION 'invalid requester' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_run.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_terminal', 'state', v_run.state);
  END IF;
  IF v_run.state = 'cancel_requested' THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'cancel_requested', 'state', v_run.state);
  END IF;

  PERFORM public.agent__set_event_context('operator', v_by, 'cancel_requested');
  INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
  VALUES (v_run.tenant_id, v_run.id, 'cancel_requested', 'operator', v_by, 'cancel_requested');

  IF v_run.state = 'running' THEN
    -- A live worker stops at its next safe checkpoint; if it died, claim/recovery completes the cancellation once
    -- its lease expires.
    UPDATE public.agent_runs SET state = 'cancel_requested', cancel_requested_at = now(), cancel_requested_by = v_by
     WHERE id = v_run.id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'cancel_requested', 'state', 'cancel_requested');
  END IF;

  UPDATE public.agent_runs SET cancel_requested_at = now(), cancel_requested_by = v_by WHERE id = v_run.id;
  PERFORM public.agent__set_event_context('operator', v_by, 'cancelled');
  PERFORM public.agent__finish_run(v_run.id, 'cancelled', NULL, 'cancelled', false);
  RETURN jsonb_build_object('ok', true, 'outcome', 'cancelled', 'state', 'cancelled');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_run_request_pause(p_tenant_id uuid, p_run_id uuid, p_requested_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_by  text := CASE WHEN p_requested_by ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_requested_by END;
BEGIN
  IF v_by IS NULL THEN
    RAISE EXCEPTION 'invalid requester' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_run.state = 'paused' THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'paused', 'state', v_run.state);
  END IF;
  IF v_run.state NOT IN ('queued', 'retry_wait', 'running') THEN
    -- Terminal runs cannot pause, and a pending cancellation is never overridden by a pause.
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pausable', 'state', v_run.state);
  END IF;

  INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
  VALUES (v_run.tenant_id, v_run.id, 'pause_requested', 'operator', v_by, 'pause_requested');

  IF v_run.state = 'running' THEN
    UPDATE public.agent_runs SET pause_requested_at = now(), pause_requested_by = v_by WHERE id = v_run.id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'pause_requested', 'state', 'running');
  END IF;

  PERFORM public.agent__set_event_context('operator', v_by, 'paused');
  UPDATE public.agent_run_steps SET state = 'pending', next_attempt_at = NULL
   WHERE run_id = v_run.id AND state = 'retry_wait';
  PERFORM public.agent__drop_dispatch(v_run.id, v_run.queue_msg_id, false);
  UPDATE public.agent_runs SET state = 'paused', pause_requested_at = now(), pause_requested_by = v_by, next_attempt_at = NULL
   WHERE id = v_run.id;
  RETURN jsonb_build_object('ok', true, 'outcome', 'paused', 'state', 'paused');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_run_resume(p_tenant_id uuid, p_run_id uuid, p_requested_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_by  text := CASE WHEN p_requested_by ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN p_requested_by END;
BEGIN
  IF v_by IS NULL THEN
    RAISE EXCEPTION 'invalid requester' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_run.state = 'running' AND v_run.pause_requested_at IS NOT NULL THEN
    UPDATE public.agent_runs SET pause_requested_at = NULL, pause_requested_by = NULL WHERE id = v_run.id;
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
    VALUES (v_run.tenant_id, v_run.id, 'pause_withdrawn', 'operator', v_by, 'pause_withdrawn');
    RETURN jsonb_build_object('ok', true, 'outcome', 'pause_withdrawn', 'state', 'running');
  END IF;
  IF v_run.state <> 'paused' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paused', 'state', v_run.state);
  END IF;
  IF v_run.deadline_at <= now() THEN
    PERFORM public.agent__set_event_context('operator', v_by, 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    RETURN jsonb_build_object('ok', false, 'reason', 'deadline_exceeded', 'state', 'failed');
  END IF;

  PERFORM public.agent__set_event_context('operator', v_by, 'resumed');
  UPDATE public.agent_runs SET state = 'queued', pause_requested_at = NULL, pause_requested_by = NULL WHERE id = v_run.id;
  INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code)
  VALUES (v_run.tenant_id, v_run.id, 'resumed', 'operator', v_by, 'resumed');
  PERFORM public.agent__dispatch(v_run.id, 0);
  RETURN jsonb_build_object('ok', true, 'outcome', 'resumed', 'state', 'queued');
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_run_get(p_tenant_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
    'run', public.agent__run_json(r),
    'steps', COALESCE((SELECT jsonb_agg(public.agent__step_json(s) ORDER BY s.step_number)
                         FROM public.agent_run_steps s WHERE s.run_id = r.id AND s.tenant_id = r.tenant_id), '[]'::jsonb))
  END
  FROM (SELECT 1) one
  LEFT JOIN public.agent_runs r ON r.id = p_run_id AND r.tenant_id = p_tenant_id;
$function$;

CREATE OR REPLACE FUNCTION public.agent_run_events_page(
  p_tenant_id uuid, p_run_id uuid, p_after_id bigint DEFAULT 0, p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'step_id', e.step_id, 'event_type', e.event_type, 'from_state', e.from_state,
           'to_state', e.to_state, 'attempt', e.attempt, 'fencing_token', e.fencing_token, 'actor_kind', e.actor_kind,
           'actor_ref', e.actor_ref, 'reason_code', e.reason_code, 'detail', e.detail, 'created_at', e.created_at)
         ORDER BY e.id), '[]'::jsonb)
  FROM (SELECT * FROM public.agent_run_events
         WHERE tenant_id = p_tenant_id AND run_id = p_run_id AND id > COALESCE(p_after_id, 0)
         ORDER BY id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)) e;
$function$;

-- =============================================================================
-- Recovery: bounded, idempotent, safe to run from several workers at once (FOR UPDATE SKIP LOCKED).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_runs_recover(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_run public.agent_runs%ROWTYPE;
  v_cancelled integer := 0;
  v_expired integer := 0;
  v_redispatched integer := 0;
  v_delay integer;
BEGIN
  PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', NULL);

  -- 1. Cancellation requested, but the owning worker's lease has expired: finish the cancellation.
  FOR v_run IN
    SELECT * FROM public.agent_runs
     WHERE state = 'cancel_requested' AND (lease_expires_at IS NULL OR lease_expires_at <= now())
     ORDER BY updated_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', 'cancelled_after_lease_expiry');
    PERFORM public.agent__finish_run(v_run.id, 'cancelled', NULL, 'cancelled', false);
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- 2. Deadline passed and nobody holds a live lease: fail it.
  FOR v_run IN
    SELECT * FROM public.agent_runs
     WHERE state IN ('queued', 'retry_wait', 'paused', 'running') AND deadline_at <= now()
       AND (lease_expires_at IS NULL OR lease_expires_at <= now())
     ORDER BY deadline_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.agent__set_event_context('recovery', 'agent_runs_recover', 'deadline_exceeded');
    PERFORM public.agent__finish_run(v_run.id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    v_expired := v_expired + 1;
  END LOOP;

  -- 3. Committed runnable work whose authoritative message is missing: dispatch it again (never a new run).
  FOR v_run IN
    SELECT r.* FROM public.agent_runs r
     WHERE (r.state IN ('queued', 'retry_wait')
            OR (r.state = 'running' AND r.lease_expires_at <= now()))
       AND (r.queue_msg_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM pgmq.q_patelrep_agent_runs_v1 q WHERE q.msg_id = r.queue_msg_id))
     ORDER BY r.updated_at LIMIT v_limit FOR UPDATE OF r SKIP LOCKED
  LOOP
    v_delay := CASE WHEN v_run.state = 'retry_wait' AND v_run.next_attempt_at > now()
                    THEN CEIL(EXTRACT(EPOCH FROM (v_run.next_attempt_at - now())))::integer ELSE 0 END;
    PERFORM public.agent__dispatch(v_run.id, v_delay);
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, actor_kind, actor_ref, reason_code, detail)
    VALUES (v_run.tenant_id, v_run.id, 'redispatched', 'recovery', 'agent_runs_recover', 'dispatch_missing',
            jsonb_build_object('previous_msg_id', v_run.queue_msg_id));
    v_redispatched := v_redispatched + 1;
  END LOOP;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'deadline_failed', v_expired, 'redispatched', v_redispatched);
END;
$function$;

-- =============================================================================
-- Diagnostics (platform operations; metadata only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_execution_diagnostics(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH lim AS (SELECT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200) AS n)
  SELECT jsonb_build_object(
    'generated_at', now(),
    'runs_by_state', COALESCE((SELECT jsonb_object_agg(state, n) FROM (
        SELECT state, count(*) AS n FROM public.agent_runs GROUP BY state) s), '{}'::jsonb),
    'oldest_queued_at', (SELECT min(updated_at) FROM public.agent_runs WHERE state = 'queued'),
    'expired_leases', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('run_id', id, 'tenant_id', tenant_id, 'state', state, 'lease_owner', lease_owner,
                                  'lease_expires_at', lease_expires_at, 'fencing_token', fencing_token) AS x
          FROM public.agent_runs WHERE lease_expires_at <= now()
         ORDER BY lease_expires_at LIMIT (SELECT n FROM lim)) e), '[]'::jsonb),
    'missing_dispatch', (SELECT count(*) FROM public.agent_runs r
        WHERE r.state IN ('queued', 'retry_wait')
          AND (r.queue_msg_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM pgmq.q_patelrep_agent_runs_v1 q WHERE q.msg_id = r.queue_msg_id))),
    'dead_letters', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('run_id', id, 'tenant_id', tenant_id, 'last_error_class', last_error_class,
                                  'last_error_code', last_error_code, 'attempt_count', attempt_count,
                                  'completed_at', completed_at) AS x
          FROM public.agent_runs WHERE state = 'dead_letter'
         ORDER BY completed_at DESC LIMIT (SELECT n FROM lim)) d), '[]'::jsonb),
    'queue', jsonb_build_object(
        'name', 'patelrep_agent_runs_v1',
        'depth', (SELECT count(*) FROM pgmq.q_patelrep_agent_runs_v1),
        'visible', (SELECT count(*) FROM pgmq.q_patelrep_agent_runs_v1 WHERE vt <= now()),
        'oldest_enqueued_at', (SELECT min(enqueued_at) FROM pgmq.q_patelrep_agent_runs_v1),
        'max_read_ct', (SELECT max(read_ct) FROM pgmq.q_patelrep_agent_runs_v1),
        'archived', (SELECT count(*) FROM pgmq.a_patelrep_agent_runs_v1)),
    'controls', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'scope', scope, 'tenant_id', tenant_id, 'agent_id', agent_id, 'paused', paused,
        'cost_emergency_stop', cost_emergency_stop, 'reason_code', reason_code, 'updated_by', updated_by,
        'updated_at', updated_at)) FROM public.agent_runtime_controls), '[]'::jsonb),
    'workers', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.last_seen_at DESC)
        FROM public.agent_worker_heartbeats w), '[]'::jsonb));
$function$;

-- =============================================================================
-- Runtime controls and worker liveness
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_runtime_control_set(
  p_scope text, p_tenant_id uuid, p_agent_id text, p_paused boolean, p_cost_emergency_stop boolean,
  p_updated_by text, p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_row public.agent_runtime_controls%ROWTYPE;
BEGIN
  INSERT INTO public.agent_runtime_controls (scope, tenant_id, agent_id, paused, cost_emergency_stop, reason_code, updated_by)
  VALUES (p_scope, p_tenant_id, p_agent_id, COALESCE(p_paused, false), COALESCE(p_cost_emergency_stop, false),
          p_reason_code, p_updated_by)
  ON CONFLICT (scope, tenant_id, agent_id) DO UPDATE SET
    paused = EXCLUDED.paused, cost_emergency_stop = EXCLUDED.cost_emergency_stop,
    reason_code = EXCLUDED.reason_code, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_worker_heartbeat(
  p_worker_id text, p_status text, p_app_env text, p_version text, p_concurrency integer, p_in_flight integer,
  p_started_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  INSERT INTO public.agent_worker_heartbeats (worker_id, status, app_env, version, concurrency, in_flight, started_at, last_seen_at)
  VALUES (p_worker_id, p_status, p_app_env, p_version, p_concurrency, p_in_flight, p_started_at, now())
  ON CONFLICT (worker_id) DO UPDATE SET
    status = EXCLUDED.status, app_env = EXCLUDED.app_env, version = EXCLUDED.version,
    concurrency = EXCLUDED.concurrency, in_flight = EXCLUDED.in_flight, started_at = EXCLUDED.started_at,
    last_seen_at = now();
$function$;

REVOKE ALL ON FUNCTION public.agent_run_request_cancel(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_request_pause(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_resume(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_get(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_events_page(uuid, uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_runs_recover(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_execution_diagnostics(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_runtime_control_set(text, uuid, text, boolean, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_worker_heartbeat(text, text, text, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent_run_request_cancel(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_request_pause(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_resume(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_get(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_events_page(uuid, uuid, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_runs_recover(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_execution_diagnostics(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_runtime_control_set(text, uuid, text, boolean, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_worker_heartbeat(text, text, text, text, integer, integer, timestamptz) TO service_role;
