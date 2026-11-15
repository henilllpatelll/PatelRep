-- =============================================================================
-- Migration 246: Agent Harness H3 -- admit the orchestrator to H1 durable execution (reviewed constraint changes)
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. The only DROP statements replace two H1/H2 CHECK constraints; no table, column, row,
--   index or function is removed. Exact effect: (1) agent_runs_h2_agent_allowlist -> agent_runs_h3_agent_allowlist
--   WIDENS the admitted agents by exactly one, harness.orchestrator v1 with an empty synthetic_spec; the insert guard
--   (redefined below) confines that agent to agent_planning_run_admit (migration 247). (2)
--   agent_run_steps_step_type_allowlist WIDENS by exactly one step type, model_planning. Every existing row satisfies
--   both. The new run kind grants NO operational authority: the orchestrator has no tool pins, is absent from the
--   gateway allowlist (agent__gateway_tool_spec) and every paid call it makes is reserved in the provider-spend ledger
--   (245). To roll back behaviour, leave AGENT_ORCHESTRATOR_EXECUTION_ENABLED unset and agent_model_enablement.enabled
--   false: planning runs are then neither admitted nor processed. Reverting the schema itself needs a new, separately
--   reviewed forward migration; migration history is never rewritten.
-- =============================================================================

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_h2_agent_allowlist;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_h3_agent_allowlist CHECK (
  (agent_id = 'harness.synthetic' AND agent_version = 1)
  OR (agent_id = 'engineering.dispatch_assistant' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb)
  OR (agent_id = 'harness.orchestrator' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb));

ALTER TABLE public.agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_step_type_allowlist;
ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_step_type_allowlist CHECK (step_type IN (
  'synthetic_noop', 'synthetic_transient_failure', 'synthetic_permanent_failure', 'synthetic_delay', 'tool_invocation',
  'model_planning'));

-- Each non-synthetic agent enters only through its own admission RPC, which sets its own transaction-local marker.
-- The dispatch assistant keeps requiring the gateway marker (unchanged); the orchestrator requires the planning marker.
CREATE OR REPLACE FUNCTION public.agent__guard_gateway_run_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.agent_id = 'harness.synthetic' THEN
    RETURN NEW;
  END IF;
  IF NEW.agent_id = 'harness.orchestrator' THEN
    IF COALESCE(current_setting('patelrep.agent_planning_admission', true), '') <> 'on' THEN
      RAISE EXCEPTION 'orchestrator runs are admitted only through agent_planning_run_admit' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('patelrep.agent_gateway_admission', true), '') <> 'on' THEN
    RAISE EXCEPTION 'gateway agent runs are admitted only through agent_tool_run_admit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.agent__guard_gateway_run_insert() FROM PUBLIC, anon, authenticated;
