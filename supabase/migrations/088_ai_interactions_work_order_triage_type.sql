-- =============================================================================
-- Migration 088: Add work_order_triage to ai_interactions.interaction_type
-- =============================================================================
-- Migration 013's original CHECK constraint on ai_interactions.interaction_type
-- only allowed 8 values (task_creation, room_prediction, sop_query,
-- failure_prediction, shift_summary, gm_insight, assignment_suggestion,
-- onboarding_assistant). The live constraint has drifted from that migration
-- text (not tracked by any subsequent migration) and still only allows those
-- original 8 — every other interaction_type value now used in code
-- (work_order_creation, guest_request_creation, task_assignment,
-- housekeeping_briefing, general) 500s on the unconditional log_ai_interaction
-- call at the end of copilot_chat. That broader drift is out of this phase's
-- scope and is tracked separately (see .wolf/buglog.json + 13-02-SUMMARY.md);
-- this migration adds only the new 'work_order_triage' value introduced by
-- 13-02, which is required for that plan's own success-path to ever complete
-- against the live database.
-- =============================================================================

ALTER TABLE ai_interactions DROP CONSTRAINT IF EXISTS ai_interactions_interaction_type_check;

ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_interaction_type_check CHECK (
  interaction_type IN (
    'task_creation',
    'room_prediction',
    'sop_query',
    'failure_prediction',
    'shift_summary',
    'gm_insight',
    'assignment_suggestion',
    'onboarding_assistant',
    'work_order_triage'
  )
);
