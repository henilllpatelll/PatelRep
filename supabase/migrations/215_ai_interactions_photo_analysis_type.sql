-- =============================================================================
-- Migration 215: Widen ai_interactions.interaction_type for photo analysis
-- =============================================================================
-- POST /v1/ai/photo-analysis (mobile Report Issue, optional "Analyze photo")
-- logs each call as interaction_type 'photo_analysis'. Mirrors migrations 091 /
-- 099 / 100: drop and re-add the CHECK with every previously-allowed value kept
-- (additive only) plus the one new value. The API also tolerates a failed log
-- insert on this path, so the analysis itself never depends on this migration
-- having been applied yet.
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
    'housekeeper_shift_recap',
    'photo_analysis'
  )
);
