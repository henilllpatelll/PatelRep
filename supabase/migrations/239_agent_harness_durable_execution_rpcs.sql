-- =============================================================================
-- Migration 239: Agent Harness H1 -- durable execution RPCs
-- =============================================================================
-- Additive only: new functions over the migration 238 tables. Each RPC is ONE transaction, so a state change, its
-- event and its queue operation commit or roll back together. All functions are SECURITY INVOKER with an empty
-- search_path (every object is schema-qualified), are revoked from PUBLIC/anon/authenticated and granted only to
-- service_role.
--
-- Invariants these functions establish (see docs/agent-harness/durable-execution.md):
--   * Admission inserts the run, its first step, its 'admitted' event and its queue message atomically. A retry with
--     the same (tenant, idempotency_key) returns the same run; a different request digest under the same key fails.
--   * The run row is authoritative. A queue message is only a wake-up hint: claim re-reads the row under FOR UPDATE and
--     only the message recorded in agent_runs.queue_msg_id may start work; any other message is a duplicate.
--   * Claiming increments the fencing token. Every worker write (heartbeat, complete, fail, acknowledge) must present
--     the current token, the same lease owner and an UNEXPIRED lease, or it changes nothing.
--   * Terminal transitions delete (or archive) the dispatch message in the same transaction, so a crash can never
--     leave a finished run re-deliverable as work.
--   * Recovery re-dispatches committed runnable runs whose message is missing; it never creates a run.
-- =============================================================================

-- Internal: transaction-local actor/reason context for trigger-written events.
CREATE OR REPLACE FUNCTION public.agent__set_event_context(p_actor_kind text, p_actor_ref text, p_reason text)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $function$
  SELECT set_config('patelrep.agent_actor_kind', COALESCE(p_actor_kind, 'service'), true),
         set_config('patelrep.agent_actor_ref', COALESCE(p_actor_ref, ''), true),
         set_config('patelrep.agent_reason', COALESCE(p_reason, ''), true);
$function$;

-- Internal: why execution is blocked for this hotel/agent right now (NULL = not blocked).
CREATE OR REPLACE FUNCTION public.agent__control_block_reason(p_tenant_id uuid, p_agent_id text)
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'platform' AND cost_emergency_stop) THEN 'cost_emergency_stop'
    WHEN EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'platform' AND paused) THEN 'platform_paused'
    WHEN EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'hotel' AND tenant_id = p_tenant_id AND paused) THEN 'hotel_paused'
    WHEN EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'agent' AND agent_id = p_agent_id AND paused) THEN 'agent_paused'
  END;
$function$;

-- Internal: the dispatch envelope. Identifiers only -- never tokens, roles, prompts or business arguments.
CREATE OR REPLACE FUNCTION public.agent__envelope(p_run_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object('v', 1, 'run_id', p_run_id);
$function$;

-- Internal: send a dispatch message (optionally delayed) and record it as the run's authoritative message.
CREATE OR REPLACE FUNCTION public.agent__dispatch(p_run_id uuid, p_delay_seconds integer)
RETURNS bigint LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_msg_id bigint;
BEGIN
  SELECT pgmq.send('patelrep_agent_runs_v1', public.agent__envelope(p_run_id), GREATEST(COALESCE(p_delay_seconds, 0), 0)::integer)
    INTO v_msg_id;
  UPDATE public.agent_runs SET queue_msg_id = v_msg_id WHERE id = p_run_id;
  RETURN v_msg_id;
END;
$function$;

-- Internal: acknowledge (remove) the run's dispatch message; p_archive keeps a copy in the pgmq archive table.
CREATE OR REPLACE FUNCTION public.agent__drop_dispatch(p_run_id uuid, p_msg_id bigint, p_archive boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
BEGIN
  IF p_msg_id IS NOT NULL THEN
    IF p_archive THEN
      PERFORM pgmq.archive('patelrep_agent_runs_v1', p_msg_id);
    ELSE
      PERFORM pgmq.delete('patelrep_agent_runs_v1', p_msg_id);
    END IF;
  END IF;
  UPDATE public.agent_runs SET queue_msg_id = NULL WHERE id = p_run_id AND queue_msg_id IS NOT DISTINCT FROM p_msg_id;
END;
$function$;

-- Internal: replace the run's dispatch with a fresh delayed message. Used whenever a delivery ends without work being
-- started (busy, not due, blocked, yielded), so pgmq read_ct only grows across real claim/crash cycles.
CREATE OR REPLACE FUNCTION public.agent__redispatch(p_run_id uuid, p_old_msg_id bigint, p_delay_seconds integer)
RETURNS bigint LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
BEGIN
  PERFORM public.agent__drop_dispatch(p_run_id, p_old_msg_id, false);
  RETURN public.agent__dispatch(p_run_id, LEAST(GREATEST(COALESCE(p_delay_seconds, 0), 0), 3600));
END;
$function$;

-- Internal: move a run (and its unfinished steps) to a terminal state, clearing the lease and the dispatch message.
CREATE OR REPLACE FUNCTION public.agent__finish_run(
  p_run_id uuid, p_state text, p_error_class text, p_error_code text, p_archive boolean
)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_msg_id bigint;
  v_step_state text := CASE p_state WHEN 'succeeded' THEN NULL WHEN 'cancelled' THEN 'cancelled'
                                    WHEN 'dead_letter' THEN 'dead_letter' ELSE 'failed' END;
BEGIN
  SELECT queue_msg_id INTO v_msg_id FROM public.agent_runs WHERE id = p_run_id;
  IF v_step_state IS NOT NULL THEN
    UPDATE public.agent_run_steps
       SET state = v_step_state, completed_at = now(), lease_owner = NULL, lease_expires_at = NULL,
           error_class = COALESCE(p_error_class, error_class), error_code = COALESCE(p_error_code, error_code)
     WHERE run_id = p_run_id AND state IN ('pending', 'running', 'retry_wait');
  END IF;
  PERFORM public.agent__drop_dispatch(p_run_id, v_msg_id, p_archive);
  UPDATE public.agent_runs
     SET state = p_state, completed_at = now(), lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL,
         next_attempt_at = NULL, queue_msg_id = NULL,
         last_error_class = CASE WHEN p_state = 'succeeded' THEN NULL ELSE COALESCE(p_error_class, last_error_class) END,
         last_error_code = CASE WHEN p_state = 'succeeded' THEN NULL ELSE COALESCE(p_error_code, last_error_code) END
   WHERE id = p_run_id;
END;
$function$;

-- Internal: lock the run and prove the caller still owns it (token + owner + live lease).
CREATE OR REPLACE FUNCTION public.agent__owned_run(p_run_id uuid, p_fencing_token bigint, p_worker text)
RETURNS public.agent_runs LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.fencing_token IS DISTINCT FROM p_fencing_token OR v_run.lease_owner IS DISTINCT FROM p_worker
     OR v_run.lease_expires_at IS NULL OR v_run.lease_expires_at <= now()
     OR v_run.state NOT IN ('running', 'cancel_requested') THEN
    RETURN NULL;
  END IF;
  RETURN v_run;
END;
$function$;

-- Internal: public projection of a run (sanitized; no digest, no lease owner of other workers is hidden from ops).
CREATE OR REPLACE FUNCTION public.agent__run_json(p_run public.agent_runs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_run.id, 'tenant_id', p_run.tenant_id, 'agent_id', p_run.agent_id, 'agent_version', p_run.agent_version,
    'principal_type', p_run.principal_type, 'initiated_by_user_id', p_run.initiated_by_user_id,
    'system_principal_id', p_run.system_principal_id, 'trigger_type', p_run.trigger_type, 'state', p_run.state,
    'correlation_id', p_run.correlation_id, 'policy_version', p_run.policy_version,
    'synthetic_spec', p_run.synthetic_spec, 'created_at', p_run.created_at, 'updated_at', p_run.updated_at,
    'started_at', p_run.started_at, 'completed_at', p_run.completed_at, 'deadline_at', p_run.deadline_at,
    'attempt_count', p_run.attempt_count, 'max_attempts', p_run.max_attempts, 'next_attempt_at', p_run.next_attempt_at,
    'cancel_requested_at', p_run.cancel_requested_at, 'pause_requested_at', p_run.pause_requested_at,
    'last_error_class', p_run.last_error_class, 'last_error_code', p_run.last_error_code,
    'lease_owner', p_run.lease_owner, 'lease_expires_at', p_run.lease_expires_at,
    'last_heartbeat_at', p_run.last_heartbeat_at, 'fencing_token', p_run.fencing_token,
    'current_step_number', p_run.current_step_number);
$function$;

CREATE OR REPLACE FUNCTION public.agent__step_json(p_step public.agent_run_steps)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_step.id, 'run_id', p_step.run_id, 'step_number', p_step.step_number, 'step_type', p_step.step_type,
    'state', p_step.state, 'attempt_count', p_step.attempt_count, 'max_attempts', p_step.max_attempts,
    'next_attempt_at', p_step.next_attempt_at, 'started_at', p_step.started_at, 'completed_at', p_step.completed_at,
    'lease_expires_at', p_step.lease_expires_at, 'fencing_token', p_step.fencing_token,
    'result_meta', p_step.result_meta, 'error_class', p_step.error_class, 'error_code', p_step.error_code);
$function$;

-- =============================================================================
-- Admission
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_run_admit(
  p_tenant_id           uuid,
  p_agent_id            text,
  p_agent_version       integer,
  p_principal_type      text,
  p_user_id             uuid,
  p_system_principal_id text,
  p_trigger_type        text,
  p_idempotency_key     text,
  p_request_digest      text,
  p_correlation_id      text,
  p_policy_version      text,
  p_synthetic_spec      jsonb,
  p_first_step_type     text,
  p_deadline_seconds    integer,
  p_max_attempts        integer,
  p_step_max_attempts   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run_id  uuid;
  v_block   text;
  v_existing public.agent_runs%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND is_active) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'tenant_unavailable');
  END IF;
  IF p_principal_type = 'human' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND tenant_id = p_tenant_id AND is_active
  ) THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'principal_not_member');
  END IF;
  IF p_deadline_seconds IS NULL OR p_deadline_seconds NOT BETWEEN 1 AND 86400 THEN
    RETURN jsonb_build_object('admitted', false, 'reason', 'invalid_deadline');
  END IF;

  -- Idempotent replay is answered before controls, so a retried admission learns its existing run even while paused.
  SELECT * INTO v_existing FROM public.agent_runs WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_digest IS DISTINCT FROM p_request_digest THEN
      RETURN jsonb_build_object('admitted', false, 'reason', 'idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('admitted', true, 'created', false, 'run_id', v_existing.id, 'state', v_existing.state);
  END IF;

  v_block := public.agent__control_block_reason(p_tenant_id, p_agent_id);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('admitted', false, 'reason', v_block);
  END IF;

  PERFORM public.agent__set_event_context('admission', NULL, 'admitted');
  INSERT INTO public.agent_runs (
    tenant_id, agent_id, agent_version, principal_type, initiated_by_user_id, system_principal_id, trigger_type,
    idempotency_key, request_digest, correlation_id, policy_version, synthetic_spec, deadline_at, max_attempts)
  VALUES (
    p_tenant_id, p_agent_id, p_agent_version, p_principal_type,
    CASE WHEN p_principal_type = 'human' THEN p_user_id END,
    CASE WHEN p_principal_type = 'system' THEN p_system_principal_id END,
    p_trigger_type, p_idempotency_key, p_request_digest, p_correlation_id, p_policy_version,
    COALESCE(p_synthetic_spec, '{}'::jsonb), now() + make_interval(secs => p_deadline_seconds), p_max_attempts)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL THEN
    -- A concurrent admission with the same key committed first; we waited on its unique-index entry.
    SELECT * INTO v_existing FROM public.agent_runs WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF v_existing.request_digest IS DISTINCT FROM p_request_digest THEN
      RETURN jsonb_build_object('admitted', false, 'reason', 'idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('admitted', true, 'created', false, 'run_id', v_existing.id, 'state', v_existing.state);
  END IF;

  INSERT INTO public.agent_run_steps (run_id, tenant_id, step_number, step_type, max_attempts)
  VALUES (v_run_id, p_tenant_id, 1, p_first_step_type, p_step_max_attempts);
  PERFORM public.agent__dispatch(v_run_id, 0);
  RETURN jsonb_build_object('admitted', true, 'created', true, 'run_id', v_run_id, 'state', 'queued');
END;
$function$;

-- =============================================================================
-- Claim: read one message and, if the run is runnable, take a fenced lease on it.
-- =============================================================================
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

  IF v_run.state = 'paused' THEN
    -- A paused run holds no dispatch; resume sends a fresh one.
    PERFORM public.agent__drop_dispatch(v_run.id, v_msg.msg_id, false);
    RETURN jsonb_build_object('outcome', 'paused', 'run_id', v_run.id);
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

-- =============================================================================
-- Heartbeat: extend a LIVE lease and report cooperative-stop signals. Never revives an expired lease.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_run_heartbeat(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_lease_seconds integer DEFAULT 60, p_vt_margin integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_lease integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 900);
  v_margin integer := LEAST(GREATEST(COALESCE(p_vt_margin, 15), 1), 300);
  v_run public.agent_runs%ROWTYPE;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;
  UPDATE public.agent_runs
     SET lease_expires_at = now() + make_interval(secs => v_lease), last_heartbeat_at = now()
   WHERE id = p_run_id
  RETURNING * INTO v_run;
  UPDATE public.agent_run_steps SET lease_expires_at = v_run.lease_expires_at
   WHERE run_id = p_run_id AND state = 'running' AND fencing_token = p_fencing_token;
  IF v_run.queue_msg_id IS NOT NULL THEN
    PERFORM pgmq.set_vt('patelrep_agent_runs_v1', v_run.queue_msg_id, v_lease + v_margin);
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'lease_expires_at', v_run.lease_expires_at,
    'cancel_requested', v_run.state = 'cancel_requested',
    'pause_requested', v_run.pause_requested_at IS NOT NULL,
    'deadline_exceeded', v_run.deadline_at <= now(),
    'blocked_reason', public.agent__control_block_reason(v_run.tenant_id, v_run.agent_id));
END;
$function$;

-- =============================================================================
-- Complete the current step (fenced). Optionally start the next step under the same lease.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_step_complete(
  p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text,
  p_result_meta jsonb DEFAULT '{}'::jsonb, p_next_step_type text DEFAULT NULL, p_next_step_max_attempts integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_step public.agent_run_steps%ROWTYPE;
  v_next public.agent_run_steps%ROWTYPE;
  v_block text;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_step FROM public.agent_run_steps WHERE id = p_step_id AND run_id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_step.state <> 'running' OR v_step.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('outcome', 'step_not_owned');
  END IF;

  PERFORM public.agent__set_event_context('worker', p_worker, 'step_succeeded');
  UPDATE public.agent_run_steps
     SET state = 'succeeded', completed_at = now(), lease_owner = NULL, lease_expires_at = NULL,
         result_meta = COALESCE(p_result_meta, '{}'::jsonb)
   WHERE id = p_step_id;

  IF v_run.state = 'cancel_requested' THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'cancelled');
    PERFORM public.agent__finish_run(p_run_id, 'cancelled', NULL, 'cancelled', false);
    RETURN jsonb_build_object('outcome', 'run_cancelled');
  END IF;

  IF p_next_step_type IS NULL THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'succeeded');
    PERFORM public.agent__finish_run(p_run_id, 'succeeded', NULL, NULL, false);
    RETURN jsonb_build_object('outcome', 'run_succeeded');
  END IF;

  IF v_run.pause_requested_at IS NOT NULL THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'paused');
    INSERT INTO public.agent_run_steps (run_id, tenant_id, step_number, step_type, max_attempts)
    VALUES (p_run_id, v_run.tenant_id, v_step.step_number + 1, p_next_step_type, p_next_step_max_attempts)
    ON CONFLICT (run_id, step_number) DO NOTHING;
    PERFORM public.agent__drop_dispatch(p_run_id, v_run.queue_msg_id, false);
    UPDATE public.agent_runs
       SET state = 'paused', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL,
           current_step_number = v_step.step_number + 1
     WHERE id = p_run_id;
    RETURN jsonb_build_object('outcome', 'run_paused');
  END IF;

  v_block := public.agent__control_block_reason(v_run.tenant_id, v_run.agent_id);
  IF v_block IS NOT NULL OR v_run.deadline_at <= now() THEN
    IF v_block IS NULL THEN
      PERFORM public.agent__set_event_context('worker', p_worker, 'deadline_exceeded');
      PERFORM public.agent__finish_run(p_run_id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
      RETURN jsonb_build_object('outcome', 'run_failed', 'reason', 'deadline_exceeded');
    END IF;
    PERFORM public.agent__set_event_context('worker', p_worker, v_block);
    INSERT INTO public.agent_run_steps (run_id, tenant_id, step_number, step_type, max_attempts)
    VALUES (p_run_id, v_run.tenant_id, v_step.step_number + 1, p_next_step_type, p_next_step_max_attempts)
    ON CONFLICT (run_id, step_number) DO NOTHING;
    UPDATE public.agent_runs
       SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL,
           current_step_number = v_step.step_number + 1
     WHERE id = p_run_id;
    PERFORM public.agent__redispatch(p_run_id, v_run.queue_msg_id, 30);
    RETURN jsonb_build_object('outcome', 'yielded', 'reason', v_block);
  END IF;

  PERFORM public.agent__set_event_context('worker', p_worker, 'next_step');
  INSERT INTO public.agent_run_steps (run_id, tenant_id, step_number, step_type, max_attempts, state, attempt_count,
                                      lease_owner, lease_expires_at, fencing_token, started_at)
  VALUES (p_run_id, v_run.tenant_id, v_step.step_number + 1, p_next_step_type, p_next_step_max_attempts, 'running', 1,
          p_worker, v_run.lease_expires_at, p_fencing_token, now())
  ON CONFLICT (run_id, step_number) DO NOTHING
  RETURNING * INTO v_next;
  IF v_next.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'step_not_owned');
  END IF;
  UPDATE public.agent_runs SET current_step_number = v_next.step_number WHERE id = p_run_id;
  RETURN jsonb_build_object('outcome', 'next_step', 'step', public.agent__step_json(v_next));
END;
$function$;

-- =============================================================================
-- Fail the current step (fenced): bounded retry with a persisted schedule, or terminal failure / dead letter.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_step_fail(
  p_run_id uuid, p_step_id uuid, p_fencing_token bigint, p_worker text,
  p_error_class text, p_error_code text, p_retryable boolean, p_retry_delay_seconds integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_step public.agent_run_steps%ROWTYPE;
  v_delay integer := LEAST(GREATEST(COALESCE(p_retry_delay_seconds, 5), 1), 3600);
  v_next timestamptz;
BEGIN
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;
  SELECT * INTO v_step FROM public.agent_run_steps WHERE id = p_step_id AND run_id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_step.state <> 'running' OR v_step.fencing_token <> p_fencing_token THEN
    RETURN jsonb_build_object('outcome', 'step_not_owned');
  END IF;

  UPDATE public.agent_run_steps SET error_class = p_error_class, error_code = p_error_code WHERE id = p_step_id;

  IF v_run.state = 'cancel_requested' THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'cancelled');
    PERFORM public.agent__finish_run(p_run_id, 'cancelled', p_error_class, p_error_code, false);
    RETURN jsonb_build_object('outcome', 'run_cancelled');
  END IF;

  IF NOT COALESCE(p_retryable, false) THEN
    PERFORM public.agent__set_event_context('worker', p_worker, p_error_code);
    PERFORM public.agent__finish_run(p_run_id, 'failed', p_error_class, p_error_code, false);
    RETURN jsonb_build_object('outcome', 'run_failed');
  END IF;

  IF v_step.attempt_count >= v_step.max_attempts OR v_run.attempt_count >= v_run.max_attempts THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'retries_exhausted');
    PERFORM public.agent__finish_run(p_run_id, 'dead_letter', p_error_class, p_error_code, true);
    RETURN jsonb_build_object('outcome', 'run_dead_lettered');
  END IF;

  v_next := now() + make_interval(secs => v_delay);
  IF v_next >= v_run.deadline_at THEN
    PERFORM public.agent__set_event_context('worker', p_worker, 'deadline_exceeded');
    PERFORM public.agent__finish_run(p_run_id, 'failed', 'deadline_exceeded', 'deadline_exceeded', false);
    RETURN jsonb_build_object('outcome', 'run_failed', 'reason', 'deadline_exceeded');
  END IF;

  PERFORM public.agent__set_event_context('worker', p_worker, 'retry_scheduled');
  UPDATE public.agent_run_steps
     SET state = 'retry_wait', next_attempt_at = v_next, lease_owner = NULL, lease_expires_at = NULL
   WHERE id = p_step_id;
  -- Replace the dispatch with a delayed one (fresh read_ct) in the same transaction.
  PERFORM public.agent__drop_dispatch(p_run_id, v_run.queue_msg_id, false);
  UPDATE public.agent_runs
     SET state = 'retry_wait', next_attempt_at = v_next, lease_owner = NULL, lease_expires_at = NULL,
         lease_acquired_at = NULL, last_error_class = p_error_class, last_error_code = p_error_code
   WHERE id = p_run_id;
  PERFORM public.agent__dispatch(p_run_id, v_delay);
  RETURN jsonb_build_object('outcome', 'retry_scheduled', 'next_attempt_at', v_next);
END;
$function$;

-- =============================================================================
-- Acknowledge a cooperative stop at a safe checkpoint (fenced): cancel, pause or yield (shutdown / control block).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agent_run_acknowledge(
  p_run_id uuid, p_fencing_token bigint, p_worker text, p_action text, p_reason text DEFAULT NULL,
  p_yield_delay_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_run public.agent_runs%ROWTYPE;
  v_reason text := CASE WHEN p_reason ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason END;
BEGIN
  IF p_action NOT IN ('cancel', 'pause', 'yield') THEN
    RAISE EXCEPTION 'invalid acknowledge action' USING ERRCODE = '22023';
  END IF;
  v_run := public.agent__owned_run(p_run_id, p_fencing_token, p_worker);
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'lease_lost');
  END IF;

  IF p_action = 'cancel' THEN
    IF v_run.state <> 'cancel_requested' THEN
      RETURN jsonb_build_object('outcome', 'not_requested');
    END IF;
    PERFORM public.agent__set_event_context('worker', p_worker, 'cancelled');
    PERFORM public.agent__finish_run(p_run_id, 'cancelled', NULL, 'cancelled', false);
    RETURN jsonb_build_object('outcome', 'run_cancelled');
  END IF;

  IF v_run.state = 'cancel_requested' THEN
    RETURN jsonb_build_object('outcome', 'cancel_pending');  -- cancellation wins over pause and yield
  END IF;

  IF p_action = 'pause' THEN
    IF v_run.pause_requested_at IS NULL THEN
      RETURN jsonb_build_object('outcome', 'not_requested');
    END IF;
    PERFORM public.agent__set_event_context('worker', p_worker, 'paused');
    UPDATE public.agent_run_steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
           attempt_count = GREATEST(attempt_count - 1, 0)
     WHERE run_id = p_run_id AND state = 'running';
    PERFORM public.agent__drop_dispatch(p_run_id, v_run.queue_msg_id, false);
    UPDATE public.agent_runs SET state = 'paused', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL,
           attempt_count = GREATEST(attempt_count - 1, 0)
     WHERE id = p_run_id;
    RETURN jsonb_build_object('outcome', 'run_paused');
  END IF;

  -- yield: hand the run back to the queue without consuming an attempt (graceful shutdown or a control block).
  PERFORM public.agent__set_event_context('worker', p_worker, COALESCE(v_reason, 'yielded'));
  UPDATE public.agent_run_steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         attempt_count = GREATEST(attempt_count - 1, 0)
   WHERE run_id = p_run_id AND state = 'running';
  UPDATE public.agent_runs SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, lease_acquired_at = NULL,
         attempt_count = GREATEST(attempt_count - 1, 0)
   WHERE id = p_run_id;
  PERFORM public.agent__redispatch(p_run_id, v_run.queue_msg_id, p_yield_delay_seconds);
  RETURN jsonb_build_object('outcome', 'run_yielded');
END;
$function$;

REVOKE ALL ON FUNCTION public.agent__set_event_context(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__control_block_reason(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__envelope(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__dispatch(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__drop_dispatch(uuid, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__redispatch(uuid, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__finish_run(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__owned_run(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__run_json(public.agent_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__step_json(public.agent_run_steps) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_admit(uuid, text, integer, text, uuid, text, text, text, text, text, text, jsonb, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_claim(text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_heartbeat(uuid, bigint, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_step_complete(uuid, uuid, bigint, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_step_fail(uuid, uuid, bigint, text, text, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_run_acknowledge(uuid, bigint, text, text, text, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agent__set_event_context(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__control_block_reason(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__envelope(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__dispatch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__drop_dispatch(uuid, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__redispatch(uuid, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__finish_run(uuid, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__owned_run(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__run_json(public.agent_runs) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__step_json(public.agent_run_steps) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_admit(uuid, text, integer, text, uuid, text, text, text, text, text, text, jsonb, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_claim(text, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_heartbeat(uuid, bigint, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_step_complete(uuid, uuid, bigint, text, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_step_fail(uuid, uuid, bigint, text, text, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_acknowledge(uuid, bigint, text, text, text, integer) TO service_role;
