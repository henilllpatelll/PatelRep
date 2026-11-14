-- =============================================================================
-- Migration 241: Agent Harness H2 -- Tool Gateway schema
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. The only DROP statements replace three H1 CHECK constraints with STRICTER-OR-EQUAL
--   exact allowlists (agent_runs agent allowlist, agent_runs state list + awaiting_approval, agent_run_steps step_type
--   allowlist). No table, column, row or index is removed. To roll back behaviour, set agent_execution_enablement.enabled
--   = false (and leave AGENT_GATEWAY_EXECUTION_ENABLED unset); every gateway path then fails closed while the objects stay.
--
-- New tables (all tenant-scoped through (run_id, tenant_id) foreign keys, RLS on, service role only):
--   agent_tool_invocations      the immutable proposed tool call of a run step (tool, version, canonical arguments,
--                               server-verified resource, action digest, server-derived idempotency key)
--   agent_tool_approvals        the persistent human-approval lifecycle bound to ONE invocation and its digest
--   agent_tool_executions       the idempotency ledger: one immutable outcome per (tenant, idempotency key)
--   agent_tool_events           append-only tool audit (every attempt, decision and replay)
--   agent_tool_grants           per-property x agent x tool enablement and autonomy ceiling (H0 AutonomyGrant)
--   agent_tool_controls         per-tool pause (H0 RuntimeControls.paused_tools)
--   agent_execution_enablement  the single platform switch for gateway execution; default OFF. It is one of several
--                               independent layers (code allowlist, APP_ENV, AGENT_GATEWAY_EXECUTION_ENABLED, tenant
--                               entitlement, grant, approval) and can never authorize anything by itself.
--
-- H1 changes (exact, reviewed):
--   * agent_runs_h1_synthetic_only -> agent_runs_h2_agent_allowlist: exactly the synthetic probe and the H2 dispatch
--     assistant (engineering.dispatch_assistant v1). Gateway runs may only be INSERTED by agent_tool_run_admit
--     (transaction-local admission marker checked by trigger), never by agent_run_admit.
--   * run state 'awaiting_approval' with exactly four new transitions (running -> awaiting_approval and
--     awaiting_approval -> queued | cancelled | failed). The run holds no lease and no queue message while waiting.
--   * agent_run_steps.step_type becomes an exact allowlist (the four synthetic types + 'tool_invocation').
-- =============================================================================

-- -----------------------------------------------------------------------------
-- H1 constraint replacements
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_h1_synthetic_only;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_h2_agent_allowlist CHECK (
  (agent_id = 'harness.synthetic' AND agent_version = 1)
  OR (agent_id = 'engineering.dispatch_assistant' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb));

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_state_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_state_check CHECK (state IN (
  'queued', 'running', 'retry_wait', 'paused', 'cancel_requested', 'awaiting_approval',
  'succeeded', 'failed', 'cancelled', 'dead_letter'));

ALTER TABLE public.agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_step_type_check;
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_step_type_allowlist CHECK (step_type IN (
  'synthetic_noop', 'synthetic_transient_failure', 'synthetic_permanent_failure', 'synthetic_delay', 'tool_invocation'));

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
        ('running', 'awaiting_approval'),
        ('retry_wait', 'running'), ('retry_wait', 'paused'), ('retry_wait', 'cancelled'), ('retry_wait', 'failed'),
        ('retry_wait', 'dead_letter'),
        ('paused', 'queued'), ('paused', 'cancelled'), ('paused', 'failed'),
        ('cancel_requested', 'cancelled'), ('cancel_requested', 'failed'),
        ('awaiting_approval', 'queued'), ('awaiting_approval', 'cancelled'), ('awaiting_approval', 'failed'));
$function$;

-- Gateway runs enter only through agent_tool_run_admit (migration 243), which sets this transaction-local marker.
CREATE OR REPLACE FUNCTION public.agent__guard_gateway_run_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.agent_id <> 'harness.synthetic'
     AND COALESCE(current_setting('patelrep.agent_gateway_admission', true), '') <> 'on' THEN
    RAISE EXCEPTION 'gateway agent runs are admitted only through agent_tool_run_admit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_runs_guard_gateway_insert ON public.agent_runs;
CREATE TRIGGER agent_runs_guard_gateway_insert BEFORE INSERT ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_gateway_run_insert();

-- -----------------------------------------------------------------------------
-- Platform switch (default OFF) and per-tool pause
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_execution_enablement (
  id           smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled      boolean     NOT NULL DEFAULT false,
  reason_code  text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  updated_by   text        NOT NULL CHECK (updated_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.agent_execution_enablement (id, enabled, reason_code, updated_by)
VALUES (1, false, 'h2_default_off', 'migration_241')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.agent_execution_enablement IS
  'Agent Harness H2 platform execution switch (single row, default off). Necessary, never sufficient: code allowlist, APP_ENV, AGENT_GATEWAY_EXECUTION_ENABLED, tenant entitlement, grant and human approval are checked independently.';

CREATE TABLE IF NOT EXISTS public.agent_tool_controls (
  tool_id      text        PRIMARY KEY CHECK (tool_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$'),
  paused       boolean     NOT NULL DEFAULT false,
  reason_code  text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  updated_by   text        NOT NULL CHECK (updated_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_tool_controls IS 'Agent Harness per-tool pause. Can only restrict execution.';

-- -----------------------------------------------------------------------------
-- Per-property x agent x tool grants (persisted H0 AutonomyGrant; no wildcard is representable)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tool_grants (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id           text        NOT NULL CHECK (agent_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  agent_version      integer     NOT NULL CHECK (agent_version BETWEEN 1 AND 999),
  tool_id            text        NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$'),
  tool_version       integer     NOT NULL CHECK (tool_version BETWEEN 1 AND 999),
  max_level          smallint    NOT NULL CHECK (max_level IN (1, 2)),  -- observe / human_approved; 3-4 unrepresentable
  max_risk           text        NOT NULL CHECK (max_risk IN ('low', 'medium', 'high')),
  granted_by_user_id uuid        NOT NULL,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_by_user_id uuid,
  CONSTRAINT agent_tool_grants_target_key UNIQUE (tenant_id, agent_id, agent_version, tool_id, tool_version),
  CONSTRAINT agent_tool_grants_expiry_shape CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT agent_tool_grants_revoke_shape CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL))
);

COMMENT ON TABLE public.agent_tool_grants IS
  'Agent Harness H2: one hotel''s explicit enablement of one agent version for one tool version, with an autonomy ceiling (1 observe, 2 human approved). Written only through agent_tool_grant_set by a current GM.';

-- -----------------------------------------------------------------------------
-- Invocations (immutable proposed tool calls)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tool_invocations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  run_id               uuid        NOT NULL,
  step_number          integer     NOT NULL CHECK (step_number BETWEEN 1 AND 50),
  agent_id             text        NOT NULL,
  agent_version        integer     NOT NULL,
  tool_id              text        NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$'),
  tool_version         integer     NOT NULL CHECK (tool_version BETWEEN 1 AND 999),
  access               text        NOT NULL CHECK (access IN ('read', 'write')),
  arguments            jsonb       NOT NULL CHECK (jsonb_typeof(arguments) = 'object' AND pg_column_size(arguments) <= 4096),
  resource_type        text        NOT NULL CHECK (resource_type IN ('hotel', 'room', 'work_order')),
  resource_id          uuid,
  action_digest        text        NOT NULL CHECK (action_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key      text        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  initiated_by_user_id uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_invocations_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_invocations_step_key UNIQUE (run_id, step_number),
  CONSTRAINT agent_tool_invocations_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT agent_tool_invocations_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_tool_invocations_resource_shape CHECK ((resource_type = 'hotel') = (resource_id IS NULL))
);

COMMENT ON TABLE public.agent_tool_invocations IS
  'Agent Harness H2 proposed tool calls. Immutable once written: an approval binds to exactly one invocation and its action digest.';

-- -----------------------------------------------------------------------------
-- Approvals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tool_approvals (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL,
  run_id                    uuid        NOT NULL,
  invocation_id             uuid        NOT NULL,
  agent_id                  text        NOT NULL,
  agent_version             integer     NOT NULL,
  tool_id                   text        NOT NULL,
  tool_version              integer     NOT NULL,
  resource_type             text        NOT NULL,
  resource_id               uuid,
  action_digest             text        NOT NULL CHECK (action_digest ~ '^[0-9a-f]{64}$'),
  initiated_by_user_id      uuid        NOT NULL,
  approval_policy_id        text        NOT NULL CHECK (approval_policy_id ~ '^[a-z][a-z0-9_.]{2,80}$'),
  approver_may_be_initiator boolean     NOT NULL,
  required_approver_roles   text[]      NOT NULL CHECK (cardinality(required_approver_roles) BETWEEN 1 AND 6),
  state                     text        NOT NULL DEFAULT 'requested'
                              CHECK (state IN ('requested', 'approved', 'rejected', 'expired', 'revoked')),
  decided_by_user_id        uuid,
  decided_role              text,
  decided_at                timestamptz,
  decision_reason_code      text        CHECK (decision_reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  ended_by                  text        CHECK (ended_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),  -- who revoked / what expired it
  ended_at                  timestamptz,
  expires_at                timestamptz NOT NULL,
  consumed_at               timestamptz,
  consumed_by_execution_id  uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_approvals_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_approvals_invocation_fk FOREIGN KEY (invocation_id, tenant_id)
    REFERENCES public.agent_tool_invocations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_approvals_one_per_invocation UNIQUE (invocation_id),
  CONSTRAINT agent_tool_approvals_expiry_shape CHECK (expires_at > created_at),
  CONSTRAINT agent_tool_approvals_decision_shape CHECK (
    (state = 'requested' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decided_role IS NULL)
    OR (state IN ('approved', 'rejected') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL
        AND decided_role IS NOT NULL)
    OR state IN ('revoked', 'expired')),
  CONSTRAINT agent_tool_approvals_end_shape CHECK (
    (state IN ('revoked', 'expired')) = (ended_by IS NOT NULL AND ended_at IS NOT NULL)),
  CONSTRAINT agent_tool_approvals_independent CHECK (
    approver_may_be_initiator OR state <> 'approved' OR decided_by_user_id IS DISTINCT FROM initiated_by_user_id),
  CONSTRAINT agent_tool_approvals_consumption_shape CHECK (
    (consumed_at IS NULL) = (consumed_by_execution_id IS NULL) AND (consumed_at IS NULL OR state = 'approved'))
);

COMMENT ON TABLE public.agent_tool_approvals IS
  'Agent Harness H2 human approvals: tenant-scoped, bound to one invocation and its action digest, time-limited, revocable and consumed at most once.';

CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_pending
  ON public.agent_tool_approvals (tenant_id, created_at DESC) WHERE state = 'requested';
CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_expiry
  ON public.agent_tool_approvals (expires_at) WHERE state IN ('requested', 'approved') AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_run ON public.agent_tool_approvals (run_id);

-- -----------------------------------------------------------------------------
-- Execution ledger (idempotency) and tool events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tool_executions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  run_id             uuid        NOT NULL,
  invocation_id      uuid        NOT NULL,
  tool_id            text        NOT NULL,
  tool_version       integer     NOT NULL,
  action_digest      text        NOT NULL CHECK (action_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key    text        NOT NULL,
  approval_id        uuid,
  fencing_token      bigint      NOT NULL CHECK (fencing_token >= 1),
  worker_id          text        NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  state              text        NOT NULL CHECK (state IN ('succeeded', 'failed')),
  error_class        text        CHECK (error_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  error_code         text        CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  result             jsonb       NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 16384),
  result_resource_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_executions_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_executions_invocation_fk FOREIGN KEY (invocation_id, tenant_id)
    REFERENCES public.agent_tool_invocations (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_executions_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT agent_tool_executions_one_per_invocation UNIQUE (invocation_id),
  CONSTRAINT agent_tool_executions_failure_shape CHECK ((state = 'failed') = (error_code IS NOT NULL))
);

COMMENT ON TABLE public.agent_tool_executions IS
  'Agent Harness H2 idempotency ledger. Written in the SAME transaction as the business mutation, so a committed outcome and its side effect are never separated. Immutable.';

CREATE TABLE IF NOT EXISTS public.agent_tool_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid        NOT NULL,
  run_id        uuid        NOT NULL,
  invocation_id uuid,
  approval_id   uuid,
  execution_id  uuid,
  event_type    text        NOT NULL CHECK (event_type IN (
                  'invocation_admitted', 'approval_requested', 'approval_approved', 'approval_rejected',
                  'approval_revoked', 'approval_expired', 'approval_resumed', 'execution_succeeded',
                  'execution_failed', 'execution_replayed', 'execution_refused', 'attempt_failed',
                  'read_succeeded', 'policy_denied')),
  actor_kind    text        NOT NULL CHECK (actor_kind IN ('admission', 'worker', 'human', 'recovery', 'operator')),
  actor_ref     text        CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  reason_code   text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  fencing_token bigint,
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_events_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_events_invocation_fk FOREIGN KEY (invocation_id, tenant_id)
    REFERENCES public.agent_tool_invocations (id, tenant_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.agent_tool_events IS
  'Append-only Agent Harness H2 tool audit (identifiers, outcomes and reason codes only; no arguments or results).';

CREATE INDEX IF NOT EXISTS idx_agent_tool_events_run ON public.agent_tool_events (tenant_id, run_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_events_invocation ON public.agent_tool_events (invocation_id) WHERE invocation_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Immutability guards
-- -----------------------------------------------------------------------------
-- Invocations, executions and tool events never change; removal only inside a tenant offboarding cascade.
CREATE OR REPLACE FUNCTION public.agent__guard_tool_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

-- Approvals: binding columns never change; terminal states never change; an approval is consumed at most once.
CREATE OR REPLACE FUNCTION public.agent__guard_approval_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.run_id, NEW.invocation_id, NEW.agent_id, NEW.agent_version, NEW.tool_id,
      NEW.tool_version, NEW.resource_type, NEW.action_digest, NEW.initiated_by_user_id, NEW.approval_policy_id,
      NEW.approver_may_be_initiator, NEW.required_approver_roles, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.run_id, OLD.invocation_id, OLD.agent_id, OLD.agent_version, OLD.tool_id,
      OLD.tool_version, OLD.resource_type, OLD.action_digest, OLD.initiated_by_user_id, OLD.approval_policy_id,
      OLD.approver_may_be_initiator, OLD.required_approver_roles, OLD.expires_at, OLD.created_at)
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
    RAISE EXCEPTION 'approval binding columns are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IN ('rejected', 'expired', 'revoked') THEN
    RAISE EXCEPTION 'approval % is terminal (%)', OLD.id, OLD.state USING ERRCODE = 'P0001';
  END IF;
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'approval % was already consumed', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'requested' AND NEW.state IN ('approved', 'rejected', 'expired', 'revoked'))
    OR (OLD.state = 'approved' AND NEW.state IN ('expired', 'revoked'))) THEN
    RAISE EXCEPTION 'illegal approval transition % -> %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state = 'approved' AND (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
       OR NEW.decided_role IS DISTINCT FROM OLD.decided_role OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'approval decision is immutable' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- An approval cannot be created already decided or consumed.
CREATE OR REPLACE FUNCTION public.agent__guard_approval_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.state <> 'requested' OR NEW.decided_by_user_id IS NOT NULL OR NEW.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'approvals are created requested' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_tool_invocations_immutable ON public.agent_tool_invocations;
CREATE TRIGGER agent_tool_invocations_immutable BEFORE UPDATE OR DELETE ON public.agent_tool_invocations
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();
DROP TRIGGER IF EXISTS agent_tool_executions_immutable ON public.agent_tool_executions;
CREATE TRIGGER agent_tool_executions_immutable BEFORE UPDATE OR DELETE ON public.agent_tool_executions
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();
DROP TRIGGER IF EXISTS agent_tool_events_immutable ON public.agent_tool_events;
CREATE TRIGGER agent_tool_events_immutable BEFORE UPDATE OR DELETE ON public.agent_tool_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();
DROP TRIGGER IF EXISTS agent_tool_approvals_guard_insert ON public.agent_tool_approvals;
CREATE TRIGGER agent_tool_approvals_guard_insert BEFORE INSERT ON public.agent_tool_approvals
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_approval_insert();
DROP TRIGGER IF EXISTS agent_tool_approvals_guard_update ON public.agent_tool_approvals;
CREATE TRIGGER agent_tool_approvals_guard_update BEFORE UPDATE ON public.agent_tool_approvals
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_approval_update();

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only (no end-user policy, no direct client mutation)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_execution_enablement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_execution_enablement, public.agent_tool_controls, public.agent_tool_grants,
              public.agent_tool_invocations, public.agent_tool_approvals, public.agent_tool_executions,
              public.agent_tool_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_execution_enablement, public.agent_tool_controls, public.agent_tool_grants,
                                public.agent_tool_approvals TO service_role;
GRANT SELECT, INSERT ON public.agent_tool_invocations, public.agent_tool_executions, public.agent_tool_events TO service_role;

REVOKE ALL ON FUNCTION public.agent_run_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_gateway_run_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_tool_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_approval_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_approval_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_run_transition_allowed(text, text) TO service_role;
