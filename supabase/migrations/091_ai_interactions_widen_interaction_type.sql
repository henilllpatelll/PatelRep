-- =============================================================================
-- Migration 091: Widen ai_interactions.interaction_type CHECK constraint (DATA-01)
-- =============================================================================
-- Migration 088 documented that this constraint had drifted untracked from
-- migration 013's original list and already knew of this gap. Direct grep of
-- every log_ai_interaction(interaction_type=...) call site in apps/api found
-- 5 real values used in code but rejected by the current 9-value constraint:
-- work_order_creation, guest_request_creation, task_assignment, general
-- (ai_copilot.py's default for any unmapped intent), housekeeping_briefing.
-- This migration is additive only -- all 9 previously-allowed values are kept.
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
    'work_order_triage',
    'work_order_creation',
    'guest_request_creation',
    'task_assignment',
    'general',
    'housekeeping_briefing'
  )
);
