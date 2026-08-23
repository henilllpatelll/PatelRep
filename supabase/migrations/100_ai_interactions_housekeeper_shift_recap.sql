-- =============================================================================
-- Migration 100: Widen ai_interactions.interaction_type CHECK constraint for
-- the new housekeeper end-of-shift AI recap endpoint
-- (POST /v1/ai/housekeeping/shift-summary, Mobile Home housekeeper design
-- import).
-- =============================================================================
-- Mirrors migration 099's pattern exactly. Adds housekeeper_shift_recap --
-- additive only, all 18 previously-allowed values are kept.
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
    'housekeeping_briefing',
    'supervisor_briefing',
    'engineer_briefing',
    'front_desk_briefing',
    'gm_briefing',
    'housekeeper_shift_recap'
  )
);
