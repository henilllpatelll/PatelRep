-- =============================================================================
-- Migration 251: Agent Harness H5 -- admit the two Operations specialists and the H5 planning intents
--                (reviewed CHECK constraint replacements only)
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. The only DROP statements replace five CHECK constraints; no table, column, row, index,
--   function or policy is removed and no data changes. Exact effect, each a WIDENING by an enumerated set:
--   (1) agent_runs_h3_agent_allowlist -> agent_runs_h5_agent_allowlist: adds exactly engineering.dispatch_assistant v2
--       and housekeeping.room_readiness_assistant v1, both with an empty synthetic_spec. The existing insert guard
--       (agent__guard_gateway_run_insert, migration 246) already confines every non-synthetic, non-orchestrator agent
--       to agent_tool_run_admit; the gateway allowlist (agent__gateway_tool_spec, migration 253) names each agent's
--       exact tool pins.
--   (2) agent_planning_runs.intent: adds exactly four reviewed H5 intents (all version 1).
--   (3) agent_planning_runs.resource_type: adds exactly 'room'.
--   (4) agent_planning_runs.plan_outcome: adds exactly 'recommended' (a read-only recommendation).
--   (5) agent_planning_runs_record_shape: 'recommended' joins the outcomes that must carry a plan.
--   Every existing row satisfies all five. To roll back behaviour, leave AGENT_GATEWAY_EXECUTION_ENABLED /
--   AGENT_ORCHESTRATOR_EXECUTION_ENABLED unset and agent_execution_enablement / agent_model_enablement false: no H5 run
--   is then admitted or processed. Reverting the schema needs a new, separately reviewed forward migration; migration
--   history is never rewritten.
-- =============================================================================

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_h3_agent_allowlist;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_h5_agent_allowlist CHECK (
  (agent_id = 'harness.synthetic' AND agent_version = 1)
  OR (agent_id = 'engineering.dispatch_assistant' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb)
  OR (agent_id = 'harness.orchestrator' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb)
  OR (agent_id = 'engineering.dispatch_assistant' AND agent_version = 2 AND synthetic_spec = '{}'::jsonb)
  OR (agent_id = 'housekeeping.room_readiness_assistant' AND agent_version = 1 AND synthetic_spec = '{}'::jsonb));

ALTER TABLE public.agent_planning_runs DROP CONSTRAINT IF EXISTS agent_planning_runs_intent_check;
ALTER TABLE public.agent_planning_runs ADD CONSTRAINT agent_planning_runs_intent_allowlist CHECK (intent IN (
  'engineering.work_order_dispatch_plan', 'engineering.work_order_triage',
  'engineering.work_order_dispatch_recommendation', 'housekeeping.room_readiness_review',
  'housekeeping.room_assignment_recommendation'));

ALTER TABLE public.agent_planning_runs DROP CONSTRAINT IF EXISTS agent_planning_runs_resource_type_check;
ALTER TABLE public.agent_planning_runs ADD CONSTRAINT agent_planning_runs_resource_type_allowlist CHECK (
  resource_type IN ('work_order', 'room'));

ALTER TABLE public.agent_planning_runs DROP CONSTRAINT IF EXISTS agent_planning_runs_plan_outcome_check;
ALTER TABLE public.agent_planning_runs ADD CONSTRAINT agent_planning_runs_plan_outcome_allowlist CHECK (
  plan_outcome IN ('proposed', 'recommended', 'refused', 'escalated', 'rejected'));

ALTER TABLE public.agent_planning_runs DROP CONSTRAINT IF EXISTS agent_planning_runs_record_shape;
ALTER TABLE public.agent_planning_runs ADD CONSTRAINT agent_planning_runs_record_shape_v2 CHECK (
  (plan_outcome IS NULL) = (recorded_at IS NULL)
  AND (plan IS NULL) = (plan_digest IS NULL)
  AND (plan_outcome IS DISTINCT FROM 'rejected' OR plan IS NULL)
  AND (plan_outcome NOT IN ('proposed', 'recommended', 'refused', 'escalated') OR plan IS NOT NULL));
