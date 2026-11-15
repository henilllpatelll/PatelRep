-- =============================================================================
-- Migration 244: Agent Harness H3 -- provider-spend ledger schema
-- =============================================================================
-- Additive only (new tables, triggers, grants and seed rows). No existing object is changed.
--
-- PROVIDER EXPENSE, NOT CUSTOMER BILLING. These tables record what model providers (OpenAI, Anthropic) charge PatelRep,
-- in USD, and enforce spending limits before every paid request. They never touch credit_ledger, ai_interactions,
-- deduct_ai_credits or Stripe; customer credits stay with the existing flow (H4 will derive credits from SETTLED rows).
--
--   agent_model_enablement        single-row paid-call switch, default OFF (one of several independent layers)
--   agent_model_price_schedules   versioned, effective-dated, immutable provider price rows (USD per million tokens)
--   agent_model_budget_policies   versioned USD limits: platform | provider | hotel | agent (period/run/step/call)
--   agent_model_budget_counters   reserved + committed USD per scope and period (row-locked by the reserve RPC)
--   agent_model_attempts          one row per potentially paid network attempt (idempotent per logical call + attempt)
--   agent_model_spend_events      append-only financial history
--
-- Money is numeric(20,8) (exact); amounts can never be negative. All tables: RLS on, no end-user policy, service role
-- only. Mutations go through the SECURITY INVOKER RPCs in migration 245; triggers enforce the state machine and
-- immutability for every writer, the service role included.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Paid-call switch (default OFF)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_enablement (
  id           smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled      boolean     NOT NULL DEFAULT false,
  reason_code  text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  updated_by   text        NOT NULL CHECK (updated_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.agent_model_enablement (id, enabled, reason_code, updated_by)
VALUES (1, false, 'h3_default_off', 'migration_244')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.agent_model_enablement IS
  'Agent Harness H3 paid model-call switch (single row, default off). Necessary, never sufficient: APP_ENV, AGENT_ORCHESTRATOR_* process gates, budget policies, runtime controls and the tenant entitlement are checked independently.';

-- -----------------------------------------------------------------------------
-- Price schedules (immutable; a price change is a new schedule_version with a new effective window)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_price_schedules (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                    text          NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                       text          NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  reported_model_aliases      text[]        NOT NULL DEFAULT '{}',
  processing_mode             text          NOT NULL DEFAULT 'standard' CHECK (processing_mode = 'standard'),
  schedule_version            text          NOT NULL CHECK (schedule_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  effective_from              timestamptz   NOT NULL,
  effective_to                timestamptz,
  input_per_mtok              numeric(20,8) NOT NULL CHECK (input_per_mtok >= 0),
  cache_read_per_mtok         numeric(20,8) CHECK (cache_read_per_mtok >= 0),
  cache_write_short_per_mtok  numeric(20,8) CHECK (cache_write_short_per_mtok >= 0),
  cache_write_long_per_mtok   numeric(20,8) CHECK (cache_write_long_per_mtok >= 0),
  output_per_mtok             numeric(20,8) NOT NULL CHECK (output_per_mtok >= 0),
  long_context_threshold      integer       CHECK (long_context_threshold > 0),
  long_input_per_mtok         numeric(20,8) CHECK (long_input_per_mtok >= 0),
  long_cache_read_per_mtok    numeric(20,8) CHECK (long_cache_read_per_mtok >= 0),
  long_cache_write_short_per_mtok numeric(20,8) CHECK (long_cache_write_short_per_mtok >= 0),
  long_cache_write_long_per_mtok  numeric(20,8) CHECK (long_cache_write_long_per_mtok >= 0),
  long_output_per_mtok        numeric(20,8) CHECK (long_output_per_mtok >= 0),
  source                      text          NOT NULL CHECK (length(source) BETWEEN 1 AND 300),
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_model_price_schedules_version_key UNIQUE (provider, model, schedule_version),
  CONSTRAINT agent_model_price_schedules_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT agent_model_price_schedules_tier_shape CHECK (
    (long_context_threshold IS NULL) = (long_input_per_mtok IS NULL)
    AND (long_input_per_mtok IS NULL) = (long_output_per_mtok IS NULL)
    AND (long_context_threshold IS NOT NULL OR (long_cache_read_per_mtok IS NULL AND long_cache_write_short_per_mtok IS NULL
                                                AND long_cache_write_long_per_mtok IS NULL))),
  CONSTRAINT agent_model_price_schedules_aliases CHECK (
    cardinality(reported_model_aliases) <= 8 AND NOT (model = ANY (reported_model_aliases)))
);

COMMENT ON TABLE public.agent_model_price_schedules IS
  'H3 provider price book (USD per million tokens). Rows are immutable except closing effective_to once; windows for one provider/model never overlap. Must equal services/agent_orchestrator/pricebook.py (drift test).';

CREATE OR REPLACE FUNCTION public.agent__guard_price_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_model_price_schedules rows are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
       OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
      RAISE EXCEPTION 'a price schedule may only be closed once (effective_to)' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_model_price:' || NEW.provider, 0));
  IF EXISTS (
    SELECT 1 FROM public.agent_model_price_schedules o
     WHERE o.provider = NEW.provider AND o.processing_mode = NEW.processing_mode AND o.id <> NEW.id
       AND (o.model = NEW.model OR o.model = ANY (NEW.reported_model_aliases)
            OR NEW.model = ANY (o.reported_model_aliases) OR o.reported_model_aliases && NEW.reported_model_aliases)
       AND tstzrange(o.effective_from, o.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'overlapping price schedule for %/%', NEW.provider, NEW.model USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_model_price_schedules_guard ON public.agent_model_price_schedules;
CREATE TRIGGER agent_model_price_schedules_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_model_price_schedules
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_price_schedule();

-- Reviewed seed: identical to services/agent_orchestrator/pricebook.py (checked 2026-11-14; sources there).
INSERT INTO public.agent_model_price_schedules (
  provider, model, schedule_version, effective_from,
  input_per_mtok, cache_read_per_mtok, cache_write_short_per_mtok, cache_write_long_per_mtok, output_per_mtok,
  long_context_threshold, long_input_per_mtok, long_cache_read_per_mtok, long_cache_write_short_per_mtok,
  long_cache_write_long_per_mtok, long_output_per_mtok, source)
VALUES
  ('openai', 'gpt-6-luna', 'openai-2026-11-14', '2026-11-14T00:00:00Z',
   0.10, 0.01, 0.125, 0.25, 0.50, 272000, 0.20, 0.02, 0.25, 0.50, 0.75,
   'developers.openai.com/api/docs/models/gpt-6-luna (checked 2026-11-14)'),
  ('openai', 'gpt-6.1-terra', 'openai-2026-11-14', '2026-11-14T00:00:00Z',
   1.00, 0.05, 1.25, 2.50, 5.00, 272000, 2.00, 0.10, 2.50, 5.00, 7.50,
   'developers.openai.com/api/docs/models/gpt-6.1-terra (checked 2026-11-14)'),
  ('anthropic', 'claude-haiku-5-5', 'anthropic-2026-11-14', '2026-11-14T00:00:00Z',
   0.10, 0.01, 0.125, 0.20, 0.50, 100000, 0.50, 0.05, 0.625, 1.00, 2.50,
   'platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-14)'),
  ('anthropic', 'claude-sonnet-5-5', 'anthropic-2026-11-14', '2026-11-14T00:00:00Z',
   2.00, 0.10, 2.50, 4.00, 10.00, NULL, NULL, NULL, NULL, NULL, NULL,
   'platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-14)')
ON CONFLICT (provider, model, schedule_version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Budget policies (versioned; a change retires the active row and inserts the next version)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_budget_policies (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                   text          NOT NULL CHECK (scope IN ('platform', 'provider', 'hotel', 'agent')),
  tenant_id               uuid          REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider                text          CHECK (provider IN ('openai', 'anthropic')),
  agent_id                text          CHECK (agent_id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  agent_version           integer       CHECK (agent_version BETWEEN 1 AND 999),
  policy_version          integer       NOT NULL CHECK (policy_version >= 1),
  period_limit_usd        numeric(20,8) NOT NULL CHECK (period_limit_usd > 0),
  run_limit_usd           numeric(20,8) CHECK (run_limit_usd > 0),
  step_limit_usd          numeric(20,8) CHECK (step_limit_usd > 0),
  call_limit_usd          numeric(20,8) CHECK (call_limit_usd > 0),
  max_uncertain_per_run   integer       CHECK (max_uncertain_per_run BETWEEN 0 AND 5),
  reason_code             text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_by              text          NOT NULL CHECK (created_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  retired_at              timestamptz,
  retired_by              text          CHECK (retired_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  CONSTRAINT agent_model_budget_policies_scope_shape CHECK (
    (scope = 'platform' AND tenant_id IS NULL AND provider IS NULL AND agent_id IS NULL AND agent_version IS NULL
       AND run_limit_usd IS NULL AND step_limit_usd IS NULL AND call_limit_usd IS NULL AND max_uncertain_per_run IS NULL)
    OR (scope = 'provider' AND tenant_id IS NULL AND provider IS NOT NULL AND agent_id IS NULL AND agent_version IS NULL
       AND run_limit_usd IS NULL AND step_limit_usd IS NULL AND call_limit_usd IS NULL AND max_uncertain_per_run IS NULL)
    OR (scope = 'hotel' AND tenant_id IS NOT NULL AND provider IS NULL AND agent_id IS NULL AND agent_version IS NULL
       AND run_limit_usd IS NULL AND step_limit_usd IS NULL AND call_limit_usd IS NULL AND max_uncertain_per_run IS NULL)
    OR (scope = 'agent' AND tenant_id IS NOT NULL AND provider IS NULL AND agent_id IS NOT NULL
       AND agent_version IS NOT NULL AND run_limit_usd IS NOT NULL AND step_limit_usd IS NOT NULL
       AND call_limit_usd IS NOT NULL AND max_uncertain_per_run IS NOT NULL
       AND call_limit_usd <= step_limit_usd AND step_limit_usd <= run_limit_usd AND run_limit_usd <= period_limit_usd)),
  CONSTRAINT agent_model_budget_policies_retire_shape CHECK ((retired_at IS NULL) = (retired_by IS NULL)),
  CONSTRAINT agent_model_budget_policies_version_key
    UNIQUE NULLS NOT DISTINCT (scope, tenant_id, provider, agent_id, agent_version, policy_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_model_budget_policies_one_active
  ON public.agent_model_budget_policies (scope, tenant_id, provider, agent_id, agent_version) NULLS NOT DISTINCT
  WHERE retired_at IS NULL;

CREATE OR REPLACE FUNCTION public.agent__guard_budget_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;  -- tenant deletion cascade
    END IF;
    RAISE EXCEPTION 'budget policies are immutable; retire and add a new version' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
     OR (to_jsonb(NEW) - 'retired_at' - 'retired_by') IS DISTINCT FROM (to_jsonb(OLD) - 'retired_at' - 'retired_by') THEN
    RAISE EXCEPTION 'a budget policy may only be retired once' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_model_budget_policies_guard ON public.agent_model_budget_policies;
CREATE TRIGGER agent_model_budget_policies_guard BEFORE UPDATE OR DELETE ON public.agent_model_budget_policies
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_budget_policy();

-- -----------------------------------------------------------------------------
-- Budget counters (reserved = open exposure incl. uncertain/unreconciled; committed = settled actual cost)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_budget_counters (
  id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text          NOT NULL CHECK (scope IN ('platform', 'provider', 'hotel', 'agent', 'run', 'step')),
  scope_key      text          NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 200),
  tenant_id      uuid          REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start   date          NOT NULL,
  reserved_usd   numeric(20,8) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  committed_usd  numeric(20,8) NOT NULL DEFAULT 0 CHECK (committed_usd >= 0),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_model_budget_counters_key UNIQUE (scope, scope_key, period_start),
  CONSTRAINT agent_model_budget_counters_tenant_shape CHECK ((scope IN ('platform', 'provider')) = (tenant_id IS NULL))
);

CREATE OR REPLACE FUNCTION public.agent__guard_budget_counter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'budget counters are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.scope, NEW.scope_key, NEW.tenant_id, NEW.period_start) IS DISTINCT FROM
     (OLD.scope, OLD.scope_key, OLD.tenant_id, OLD.period_start) THEN
    RAISE EXCEPTION 'budget counter identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.committed_usd < OLD.committed_usd THEN
    RAISE EXCEPTION 'committed provider spend never decreases' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_model_budget_counters_guard ON public.agent_model_budget_counters;
CREATE TRIGGER agent_model_budget_counters_guard BEFORE UPDATE OR DELETE ON public.agent_model_budget_counters
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_budget_counter();

-- -----------------------------------------------------------------------------
-- Attempts (one row per potentially paid provider network attempt)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_attempts (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid          NOT NULL,
  run_id                   uuid          NOT NULL,
  step_id                  uuid          NOT NULL,
  agent_id                 text          NOT NULL,
  agent_version            integer       NOT NULL,
  logical_call_key         text          NOT NULL CHECK (logical_call_key ~ '^[a-z0-9][a-z0-9:._-]{0,199}$'),
  attempt_number           integer       NOT NULL CHECK (attempt_number BETWEEN 1 AND 20),
  provider                 text          NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  requested_model          text          NOT NULL CHECK (requested_model ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  schedule_id              uuid          NOT NULL REFERENCES public.agent_model_price_schedules(id),
  schedule_version         text          NOT NULL,
  max_input_tokens         integer       NOT NULL CHECK (max_input_tokens > 0),
  max_output_tokens        integer       NOT NULL CHECK (max_output_tokens > 0),
  period_start             date          NOT NULL,
  fencing_token            bigint        NOT NULL CHECK (fencing_token >= 1),
  worker_id                text          NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  state                    text          NOT NULL DEFAULT 'reserved' CHECK (state IN (
                             'reserved', 'dispatched', 'settled', 'released', 'uncertain', 'unreconciled')),
  reserved_usd             numeric(20,8) NOT NULL CHECK (reserved_usd > 0),
  settled_usd              numeric(20,8) CHECK (settled_usd >= 0),
  overrun_usd              numeric(20,8) CHECK (overrun_usd > 0),
  reported_model           text          CHECK (reported_model ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  provider_request_id      text          CHECK (provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  provider_response_id     text          CHECK (provider_response_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  usage_status             text          CHECK (usage_status IN ('reported', 'unreported', 'malformed')),
  usage                    jsonb         CHECK (usage IS NULL OR (jsonb_typeof(usage) = 'object' AND pg_column_size(usage) <= 1024)),
  cost_status              text          CHECK (cost_status IN ('costed', 'unreconciled')),
  cost_cause               text          CHECK (cost_cause ~ '^[a-z][a-z0-9_]{0,63}$'),
  cost_tier                text          CHECK (cost_tier IN ('base', 'long')),
  error_code               text          CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  reconciliation_required  boolean       NOT NULL DEFAULT false,
  reserved_at              timestamptz   NOT NULL DEFAULT now(),
  dispatched_at            timestamptz,
  finished_at              timestamptz,
  reconciled_by            text          CHECK (reconciled_by ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  reconciled_at            timestamptz,
  reconciliation_evidence  text          CHECK (reconciliation_evidence ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT agent_model_attempts_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_model_attempts_step_fk FOREIGN KEY (step_id, run_id)
    REFERENCES public.agent_run_steps (id, run_id) ON DELETE CASCADE,
  CONSTRAINT agent_model_attempts_logical_key UNIQUE (tenant_id, logical_call_key, attempt_number),
  CONSTRAINT agent_model_attempts_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT agent_model_attempts_settled_shape CHECK (
    (state IN ('settled', 'released')) = (settled_usd IS NOT NULL AND finished_at IS NOT NULL)),
  CONSTRAINT agent_model_attempts_released_free CHECK (state <> 'released' OR settled_usd = 0),
  CONSTRAINT agent_model_attempts_dispatch_shape CHECK (
    state IN ('reserved', 'released') OR dispatched_at IS NOT NULL),
  CONSTRAINT agent_model_attempts_open_reconciliation CHECK (
    state NOT IN ('uncertain', 'unreconciled') OR reconciliation_required),
  CONSTRAINT agent_model_attempts_overrun_shape CHECK (overrun_usd IS NULL OR state = 'settled'),
  CONSTRAINT agent_model_attempts_reconciled_shape CHECK ((reconciled_by IS NULL) = (reconciled_at IS NULL))
);

CREATE OR REPLACE FUNCTION public.agent_model_attempt_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT (p_from, p_to) IN (
    ('reserved', 'dispatched'), ('reserved', 'released'),
    ('dispatched', 'settled'), ('dispatched', 'released'), ('dispatched', 'uncertain'), ('dispatched', 'unreconciled'),
    ('uncertain', 'settled'), ('uncertain', 'released'), ('uncertain', 'unreconciled'),
    ('unreconciled', 'settled'), ('unreconciled', 'released'));
$function$;

CREATE OR REPLACE FUNCTION public.agent__guard_model_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_identity text[] := ARRAY['id', 'tenant_id', 'run_id', 'step_id', 'agent_id', 'agent_version', 'logical_call_key',
                             'attempt_number', 'provider', 'requested_model', 'schedule_id', 'schedule_version',
                             'max_input_tokens', 'max_output_tokens', 'period_start', 'fencing_token', 'worker_id',
                             'reserved_usd', 'reserved_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;  -- tenant deletion cascade
    END IF;
    RAISE EXCEPTION 'model attempts are financial history and are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reserved' OR NEW.settled_usd IS NOT NULL OR NEW.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION 'an attempt is born reserved' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(v_identity) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(v_identity) k) THEN
    RAISE EXCEPTION 'attempt identity, bounds and reservation are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.state = OLD.state THEN
    IF OLD.state IN ('settled', 'released') THEN
      -- A terminal row changes only to record its (single) operator reconciliation; a flag never re-opens.
      IF OLD.reconciled_by IS NULL AND NEW.reconciled_by IS NOT NULL
         AND NOT (NEW.reconciliation_required AND NOT OLD.reconciliation_required)
         AND (to_jsonb(NEW) - 'reconciliation_required' - 'reconciled_by' - 'reconciled_at' - 'reconciliation_evidence')
             = (to_jsonb(OLD) - 'reconciliation_required' - 'reconciled_by' - 'reconciled_at' - 'reconciliation_evidence') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'attempt % is final', OLD.state USING ERRCODE = 'P0001';
    END IF;
    -- An open row may record provider evidence (usage, ids, codes) before its transition; money columns stay put.
    IF NEW.settled_usd IS DISTINCT FROM OLD.settled_usd OR NEW.overrun_usd IS DISTINCT FROM OLD.overrun_usd
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
       OR NEW.reconciled_by IS DISTINCT FROM OLD.reconciled_by THEN
      RAISE EXCEPTION 'open attempt amounts change only with a state transition' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.agent_model_attempt_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'illegal attempt transition % -> %', OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_model_attempts_guard ON public.agent_model_attempts;
CREATE TRIGGER agent_model_attempts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_model_attempts
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_model_attempt();

CREATE INDEX IF NOT EXISTS agent_model_attempts_run_idx ON public.agent_model_attempts (tenant_id, run_id, reserved_at);
CREATE INDEX IF NOT EXISTS agent_model_attempts_step_idx ON public.agent_model_attempts (step_id, run_id);
CREATE INDEX IF NOT EXISTS agent_model_attempts_open_idx ON public.agent_model_attempts (state, reserved_at)
  WHERE state IN ('reserved', 'dispatched', 'uncertain', 'unreconciled');
CREATE INDEX IF NOT EXISTS agent_model_attempts_reconcile_idx ON public.agent_model_attempts (tenant_id, reserved_at)
  WHERE reconciliation_required;
CREATE INDEX IF NOT EXISTS agent_model_attempts_schedule_idx ON public.agent_model_attempts (schedule_id);

-- -----------------------------------------------------------------------------
-- Append-only financial events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_model_spend_events (
  id          bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id      uuid,
  attempt_id  uuid,
  event_type  text          NOT NULL CHECK (event_type IN (
                'reserved', 'reservation_denied', 'reservation_replayed', 'dispatched', 'dispatch_refused', 'settled',
                'released', 'uncertain', 'unreconciled', 'overrun_detected', 'reconciled', 'recovered')),
  amount_usd  numeric(20,8) CHECK (amount_usd >= 0),
  reason_code text          CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor_kind  text          NOT NULL CHECK (actor_kind IN ('worker', 'recovery', 'operator')),
  actor_ref   text          CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  detail      jsonb         NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT agent_model_spend_events_run_fk FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.agent_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT agent_model_spend_events_attempt_fk FOREIGN KEY (attempt_id, tenant_id)
    REFERENCES public.agent_model_attempts (id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_model_spend_events_tenant_idx ON public.agent_model_spend_events (tenant_id, id);
CREATE INDEX IF NOT EXISTS agent_model_spend_events_attempt_idx ON public.agent_model_spend_events (attempt_id);
CREATE INDEX IF NOT EXISTS agent_model_spend_events_run_idx ON public.agent_model_spend_events (run_id, tenant_id);

DROP TRIGGER IF EXISTS agent_model_spend_events_immutable ON public.agent_model_spend_events;
CREATE TRIGGER agent_model_spend_events_immutable BEFORE UPDATE OR DELETE ON public.agent_model_spend_events
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_tool_immutable();

-- -----------------------------------------------------------------------------
-- RLS and privileges: backend service role only
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_model_enablement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_model_price_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_model_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_model_budget_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_model_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_model_spend_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_model_enablement, public.agent_model_price_schedules, public.agent_model_budget_policies,
              public.agent_model_budget_counters, public.agent_model_attempts, public.agent_model_spend_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_model_enablement, public.agent_model_budget_policies,
                                public.agent_model_budget_counters, public.agent_model_attempts TO service_role;
GRANT SELECT, INSERT ON public.agent_model_price_schedules, public.agent_model_spend_events TO service_role;

REVOKE ALL ON FUNCTION public.agent__guard_price_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_budget_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_budget_counter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent__guard_model_attempt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_model_attempt_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_model_attempt_transition_allowed(text, text) TO service_role;
