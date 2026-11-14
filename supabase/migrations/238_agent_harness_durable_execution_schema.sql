-- =============================================================================
-- Migration 238: Agent Harness H1 -- durable execution schema
-- =============================================================================
-- Additive only. New extension (pgmq), one LOGGED queue, five new tables, their triggers and RLS. No existing table,
-- row, policy or function is changed and nothing is backfilled. Migration 239 adds the RPCs that are the only
-- supported way to change these rows.
--
--   agent_runs                 one row per logical run; the AUTHORITATIVE execution state (the queue is only a hint)
--   agent_run_steps            ordered steps of a run; UNIQUE (run_id, step_number) so a step exists at most once
--   agent_run_events           append-only history; every run/step state change is written here by trigger
--   agent_runtime_controls     platform / hotel / agent pause and the cost emergency stop. There is deliberately NO
--                              column that enables agent execution: the H0 ceiling stays in code.
--   agent_worker_heartbeats    worker liveness for operations (not tenant data)
--
-- H1 ceiling: CHECK agent_runs_h1_synthetic_only admits only the closed synthetic probe agent. No operational agent run
-- can exist until a reviewed migration relaxes it together with the H2 Tool Gateway.
--
-- Tenant isolation: every run-owned row carries tenant_id and references its run through (run_id, tenant_id), so a
-- child row can never point at another hotel's run. RLS is enabled with no end-user policy, and PUBLIC/anon/authenticated
-- hold no privilege: only the backend service role (through the 239 RPCs) can read or write.
--
-- Rollback: the tables and queue are unused by existing features. Disable the worker (AGENT_WORKER_ENABLED unset); the
-- objects can stay in place harmlessly. Removing them needs a separately reviewed forward migration.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgmq;

-- Logged (durable) queue. pgmq.create builds a regular, WAL-logged table; pgmq.create_unlogged is never used.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'patelrep_agent_runs_v1') THEN
    PERFORM pgmq.create('patelrep_agent_runs_v1');
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- agent_runs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id             text        NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  agent_version        integer     NOT NULL CHECK (agent_version BETWEEN 1 AND 999),
  principal_type       text        NOT NULL CHECK (principal_type IN ('human', 'system')),
  initiated_by_user_id uuid,
  system_principal_id  text        CHECK (system_principal_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  trigger_type         text        NOT NULL CHECK (trigger_type IN ('user_request', 'schedule', 'event')),
  state                text        NOT NULL DEFAULT 'queued' CHECK (state IN (
                         'queued', 'running', 'retry_wait', 'paused', 'cancel_requested',
                         'succeeded', 'failed', 'cancelled', 'dead_letter')),
  idempotency_key      text        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  request_digest       text        NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  correlation_id       text        NOT NULL CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  policy_version       text        NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 64),
  synthetic_spec       jsonb       NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(synthetic_spec) = 'object' AND pg_column_size(synthetic_spec) <= 2048),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  deadline_at          timestamptz NOT NULL,
  max_attempts         integer     NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  attempt_count        integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at      timestamptz,
  cancel_requested_at  timestamptz,
  cancel_requested_by  text        CHECK (char_length(cancel_requested_by) <= 100),
  pause_requested_at   timestamptz,
  pause_requested_by   text        CHECK (char_length(pause_requested_by) <= 100),
  last_error_class     text        CHECK (last_error_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  last_error_code      text        CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  lease_owner          text        CHECK (lease_owner ~ '^[A-Za-z0-9._:-]{1,100}$'),
  lease_acquired_at    timestamptz,
  lease_expires_at     timestamptz,
  last_heartbeat_at    timestamptz,
  fencing_token        bigint      NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  current_step_number  integer     NOT NULL DEFAULT 1 CHECK (current_step_number BETWEEN 1 AND 50),
  queue_msg_id         bigint,
  CONSTRAINT agent_runs_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_runs_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT agent_runs_h1_synthetic_only CHECK (agent_id = 'harness.synthetic' AND agent_version = 1),
  CONSTRAINT agent_runs_principal_shape CHECK (
    (principal_type = 'human' AND initiated_by_user_id IS NOT NULL AND system_principal_id IS NULL)
    OR (principal_type = 'system' AND initiated_by_user_id IS NULL AND system_principal_id IS NOT NULL)),
  CONSTRAINT agent_runs_lease_shape CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT agent_runs_lease_only_while_running CHECK (
    lease_owner IS NULL OR state IN ('running', 'cancel_requested')),
  CONSTRAINT agent_runs_terminal_shape CHECK (
    state NOT IN ('succeeded', 'failed', 'cancelled', 'dead_letter') OR completed_at IS NOT NULL),
  CONSTRAINT agent_runs_retry_shape CHECK (state <> 'retry_wait' OR next_attempt_at IS NOT NULL),
  CONSTRAINT agent_runs_cancel_shape CHECK (state <> 'cancel_requested' OR cancel_requested_at IS NOT NULL)
);

COMMENT ON TABLE public.agent_runs IS
  'Agent Harness H1 durable run records (authoritative execution state). Service role only; written through the agent_* RPCs of migration 239.';
COMMENT ON COLUMN public.agent_runs.fencing_token IS
  'Monotonic ownership token. Every claim increments it; every worker write must present the current value with a live lease.';
COMMENT ON COLUMN public.agent_runs.queue_msg_id IS
  'The one pgmq message that is the authoritative dispatch for this run. Any other message naming the run is a duplicate and is discarded.';

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_created ON public.agent_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_active_state
  ON public.agent_runs (state, updated_at)
  WHERE state IN ('queued', 'running', 'retry_wait', 'paused', 'cancel_requested');
CREATE INDEX IF NOT EXISTS idx_agent_runs_lease_expiry
  ON public.agent_runs (lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_deadline
  ON public.agent_runs (deadline_at) WHERE state IN ('queued', 'running', 'retry_wait', 'paused', 'cancel_requested');
CREATE INDEX IF NOT EXISTS idx_agent_runs_dead_letter
  ON public.agent_runs (completed_at DESC) WHERE state = 'dead_letter';

-- -----------------------------------------------------------------------------
-- agent_run_steps
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid        NOT NULL,
  tenant_id        uuid        NOT NULL,
  step_number      integer     NOT NULL CHECK (step_number BETWEEN 1 AND 50),
  step_type        text        NOT NULL CHECK (step_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  state            text        NOT NULL DEFAULT 'pending' CHECK (state IN (
                     'pending', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled', 'dead_letter')),
  attempt_count    integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts     integer     NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  lease_owner      text        CHECK (lease_owner ~ '^[A-Za-z0-9._:-]{1,100}$'),
  lease_expires_at timestamptz,
  fencing_token    bigint      NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  result_meta      jsonb       NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(result_meta) = 'object' AND pg_column_size(result_meta) <= 2048),
  error_class      text        CHECK (error_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  error_code       text        CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT agent_run_steps_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_run_steps_number_key UNIQUE (run_id, step_number),
  CONSTRAINT agent_run_steps_id_run_key UNIQUE (id, run_id),
  CONSTRAINT agent_run_steps_lease_shape CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT agent_run_steps_lease_only_while_running CHECK (lease_owner IS NULL OR state = 'running'),
  CONSTRAINT agent_run_steps_terminal_shape CHECK (
    state NOT IN ('succeeded', 'failed', 'cancelled', 'dead_letter') OR completed_at IS NOT NULL),
  CONSTRAINT agent_run_steps_retry_shape CHECK (state <> 'retry_wait' OR next_attempt_at IS NOT NULL)
);

COMMENT ON TABLE public.agent_run_steps IS
  'Agent Harness H1 run steps. A step number exists once per run; tenant consistency is enforced by the (run_id, tenant_id) foreign key.';

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_tenant_run ON public.agent_run_steps (tenant_id, run_id, step_number);

-- -----------------------------------------------------------------------------
-- agent_run_events (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_run_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid        NOT NULL,
  run_id        uuid        NOT NULL,
  step_id       uuid,
  event_type    text        NOT NULL CHECK (event_type IN (
                  'admitted', 'run_state_changed', 'step_created', 'step_state_changed', 'claimed',
                  'lease_takeover', 'duplicate_delivery', 'redispatched', 'poison_message',
                  'cancel_requested', 'pause_requested', 'pause_withdrawn', 'resumed', 'control_blocked')),
  from_state    text,
  to_state      text,
  attempt       integer,
  fencing_token bigint,
  actor_kind    text        NOT NULL CHECK (actor_kind IN ('admission', 'worker', 'recovery', 'operator', 'service')),
  actor_ref     text        CHECK (actor_ref ~ '^[A-Za-z0-9._:-]{1,100}$'),
  reason_code   text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_run_events_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_run_events_step_fk FOREIGN KEY (step_id, run_id)
    REFERENCES public.agent_run_steps (id, run_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.agent_run_events IS
  'Append-only Agent Harness H1 execution history (sanitized metadata only, no prompts or payloads). Updates are always refused; rows are removed only by a tenant offboarding cascade.';

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_page ON public.agent_run_events (tenant_id, run_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_step ON public.agent_run_events (step_id) WHERE step_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- agent_runtime_controls (pauses + cost emergency stop; nothing here can ENABLE execution)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runtime_controls (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope               text        NOT NULL CHECK (scope IN ('platform', 'hotel', 'agent')),
  tenant_id           uuid        REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id            text        CHECK (agent_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  paused              boolean     NOT NULL DEFAULT false,
  cost_emergency_stop boolean     NOT NULL DEFAULT false,
  reason_code         text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  updated_by          text        NOT NULL CHECK (updated_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runtime_controls_scope_shape CHECK (
    (scope = 'platform' AND tenant_id IS NULL AND agent_id IS NULL)
    OR (scope = 'hotel' AND tenant_id IS NOT NULL AND agent_id IS NULL AND NOT cost_emergency_stop)
    OR (scope = 'agent' AND tenant_id IS NULL AND agent_id IS NOT NULL AND NOT cost_emergency_stop)),
  CONSTRAINT agent_runtime_controls_target_key UNIQUE NULLS NOT DISTINCT (scope, tenant_id, agent_id)
);

COMMENT ON TABLE public.agent_runtime_controls IS
  'Agent Harness pauses and cost emergency stop, read by admission, claim and every worker checkpoint. Can only restrict execution; there is no enable switch.';

-- -----------------------------------------------------------------------------
-- agent_worker_heartbeats (operational liveness; not tenant data)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_worker_heartbeats (
  worker_id    text        PRIMARY KEY CHECK (worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  status       text        NOT NULL CHECK (status IN ('starting', 'running', 'draining', 'stopped', 'disabled')),
  app_env      text        NOT NULL CHECK (app_env ~ '^[a-z]{1,20}$'),
  version      text        NOT NULL CHECK (char_length(version) BETWEEN 1 AND 64),
  concurrency  integer     NOT NULL CHECK (concurrency BETWEEN 0 AND 64),
  in_flight    integer     NOT NULL CHECK (in_flight >= 0),
  started_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_worker_heartbeats IS
  'Agent Harness worker liveness for the operational runbook. Contains no tenant data.';

-- -----------------------------------------------------------------------------
-- State machines (enforced for every writer, including the service role)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_run_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_from = p_to AND p_from = 'running'  -- lease takeover keeps the run running under a new fencing token
      OR (p_from, p_to) IN (
        ('queued', 'running'), ('queued', 'paused'), ('queued', 'cancelled'), ('queued', 'failed'),
        ('queued', 'dead_letter'),
        ('running', 'succeeded'), ('running', 'failed'), ('running', 'retry_wait'), ('running', 'cancel_requested'),
        ('running', 'cancelled'), ('running', 'dead_letter'), ('running', 'paused'), ('running', 'queued'),
        ('retry_wait', 'running'), ('retry_wait', 'paused'), ('retry_wait', 'cancelled'), ('retry_wait', 'failed'),
        ('retry_wait', 'dead_letter'),
        ('paused', 'queued'), ('paused', 'cancelled'), ('paused', 'failed'),
        ('cancel_requested', 'cancelled'), ('cancel_requested', 'failed'));
$function$;

CREATE OR REPLACE FUNCTION public.agent_step_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_from = p_to AND p_from = 'running'
      OR (p_from, p_to) IN (
        ('pending', 'running'), ('pending', 'cancelled'), ('pending', 'failed'), ('pending', 'dead_letter'),
        ('running', 'succeeded'), ('running', 'failed'), ('running', 'retry_wait'), ('running', 'cancelled'),
        ('running', 'dead_letter'), ('running', 'pending'),
        ('retry_wait', 'running'), ('retry_wait', 'pending'), ('retry_wait', 'cancelled'), ('retry_wait', 'failed'),
        ('retry_wait', 'dead_letter'));
$function$;

-- Actor/reason for trigger-written events come from transaction-local settings set by the 239 RPCs.
CREATE OR REPLACE FUNCTION public.agent__event_actor_kind()
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN current_setting('patelrep.agent_actor_kind', true) IN ('admission', 'worker', 'recovery', 'operator', 'service')
              THEN current_setting('patelrep.agent_actor_kind', true) ELSE 'service' END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__event_actor_ref()
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN current_setting('patelrep.agent_actor_ref', true) ~ '^[A-Za-z0-9._:-]{1,100}$'
              THEN current_setting('patelrep.agent_actor_ref', true) END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__event_reason()
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN current_setting('patelrep.agent_reason', true) ~ '^[a-z][a-z0-9_]{0,63}$'
              THEN current_setting('patelrep.agent_reason', true) END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__guard_run_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    RAISE EXCEPTION 'agent run % is terminal (%) and cannot change', OLD.id, OLD.state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT public.agent_run_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'illegal agent run transition % -> %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.fencing_token < OLD.fencing_token THEN
    RAISE EXCEPTION 'agent run fencing token cannot decrease' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.agent_id, NEW.agent_version, NEW.principal_type, NEW.trigger_type,
      NEW.idempotency_key, NEW.request_digest, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.agent_id, OLD.agent_version, OLD.principal_type, OLD.trigger_type,
      OLD.idempotency_key, OLD.request_digest, OLD.created_at)
     OR NEW.initiated_by_user_id IS DISTINCT FROM OLD.initiated_by_user_id
     OR NEW.system_principal_id IS DISTINCT FROM OLD.system_principal_id
     OR NEW.synthetic_spec IS DISTINCT FROM OLD.synthetic_spec THEN
    RAISE EXCEPTION 'agent run identity columns are immutable' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__guard_step_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.state IN ('succeeded', 'failed', 'cancelled', 'dead_letter') THEN
    RAISE EXCEPTION 'agent run step % is terminal (%) and cannot change', OLD.id, OLD.state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT public.agent_step_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'illegal agent step transition % -> %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  IF NEW.fencing_token < OLD.fencing_token THEN
    RAISE EXCEPTION 'agent step fencing token cannot decrease' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.run_id, NEW.tenant_id, NEW.step_number, NEW.step_type, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.run_id, OLD.tenant_id, OLD.step_number, OLD.step_type, OLD.created_at) THEN
    RAISE EXCEPTION 'agent step identity columns are immutable' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__guard_insert_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'agent_runs' AND NEW.state <> 'queued' THEN
    RAISE EXCEPTION 'agent runs are created queued' USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'agent_run_steps' AND NEW.state NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'agent steps are created pending or running' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__record_run_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, to_state, attempt, fencing_token, actor_kind, actor_ref, reason_code)
    VALUES (NEW.tenant_id, NEW.id, 'admitted', NEW.state, NEW.attempt_count, NEW.fencing_token,
            public.agent__event_actor_kind(), public.agent__event_actor_ref(), public.agent__event_reason());
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, event_type, from_state, to_state, attempt, fencing_token, actor_kind, actor_ref, reason_code)
    VALUES (NEW.tenant_id, NEW.id, 'run_state_changed', OLD.state, NEW.state, NEW.attempt_count, NEW.fencing_token,
            public.agent__event_actor_kind(), public.agent__event_actor_ref(), public.agent__event_reason());
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__record_step_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, step_id, event_type, to_state, attempt, fencing_token, actor_kind, actor_ref, reason_code)
    VALUES (NEW.tenant_id, NEW.run_id, NEW.id, 'step_created', NEW.state, NEW.attempt_count, NEW.fencing_token,
            public.agent__event_actor_kind(), public.agent__event_actor_ref(), public.agent__event_reason());
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.agent_run_events (tenant_id, run_id, step_id, event_type, from_state, to_state, attempt, fencing_token, actor_kind, actor_ref, reason_code)
    VALUES (NEW.tenant_id, NEW.run_id, NEW.id, 'step_state_changed', OLD.state, NEW.state, NEW.attempt_count, NEW.fencing_token,
            public.agent__event_actor_kind(), public.agent__event_actor_ref(), public.agent__event_reason());
  END IF;
  RETURN NULL;
END;
$function$;

-- Events are immutable. Removal is allowed only inside a tenant offboarding cascade (the tenant row is already gone),
-- so deleting a hotel keeps working while no application path can rewrite or erase history.
CREATE OR REPLACE FUNCTION public.agent__guard_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'agent_run_events is append-only' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    RAISE EXCEPTION 'agent_run_events is append-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS agent_runs_guard_insert ON public.agent_runs;
CREATE TRIGGER agent_runs_guard_insert BEFORE INSERT ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_insert_state();
DROP TRIGGER IF EXISTS agent_runs_guard_update ON public.agent_runs;
CREATE TRIGGER agent_runs_guard_update BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_run_update();
DROP TRIGGER IF EXISTS agent_runs_record_event ON public.agent_runs;
CREATE TRIGGER agent_runs_record_event AFTER INSERT OR UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.agent__record_run_event();

DROP TRIGGER IF EXISTS agent_run_steps_guard_insert ON public.agent_run_steps;
CREATE TRIGGER agent_run_steps_guard_insert BEFORE INSERT ON public.agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_insert_state();
DROP TRIGGER IF EXISTS agent_run_steps_guard_update ON public.agent_run_steps;
CREATE TRIGGER agent_run_steps_guard_update BEFORE UPDATE ON public.agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_step_update();
DROP TRIGGER IF EXISTS agent_run_steps_record_event ON public.agent_run_steps;
CREATE TRIGGER agent_run_steps_record_event AFTER INSERT OR UPDATE ON public.agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION public.agent__record_step_event();

DROP TRIGGER IF EXISTS agent_run_events_immutable ON public.agent_run_events;
CREATE TRIGGER agent_run_events_immutable BEFORE UPDATE OR DELETE ON public.agent_run_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_event_immutable();

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runtime_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_worker_heartbeats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_runs, public.agent_run_steps, public.agent_run_events,
              public.agent_runtime_controls, public.agent_worker_heartbeats
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_runs, public.agent_run_steps, public.agent_runtime_controls,
                                public.agent_worker_heartbeats TO service_role;
GRANT SELECT, INSERT ON public.agent_run_events TO service_role;

REVOKE ALL ON FUNCTION public.agent_run_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_step_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__event_actor_kind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__event_actor_ref() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__event_reason() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_run_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_step_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_insert_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__record_run_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__record_step_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_event_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_run_transition_allowed(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_step_transition_allowed(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__event_actor_kind() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__event_actor_ref() TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__event_reason() TO service_role;

-- The queue lives in the pgmq schema, which PostgREST does not expose. Only the service role (through the 239 RPCs)
-- may touch this queue's tables; end-user roles get nothing.
REVOKE ALL ON pgmq.q_patelrep_agent_runs_v1, pgmq.a_patelrep_agent_runs_v1 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgmq.q_patelrep_agent_runs_v1, pgmq.a_patelrep_agent_runs_v1 TO service_role;
GRANT SELECT ON pgmq.meta TO service_role;
