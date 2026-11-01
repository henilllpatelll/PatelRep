-- migration-safety: destructive-reviewed
-- rollback-plan: Re-add the previous CHECK (migration 216 value list without repair_assist) after confirming no ai_interactions rows use repair_assist. The only DROP replaces this migration's own constraint with a superset of allowed values.
-- =============================================================================
-- Migration 230: Widen ai_interactions.interaction_type for engineering repair assist
-- =============================================================================
-- POST /v1/ai/engineer/work-orders/{id}/assist (mobile Engineering, optional "AI Assist") logs each call
-- as interaction_type 'repair_assist' with its real token usage. Mirrors migrations 091 / 099 / 100 / 215 /
-- 216: drop and re-add the CHECK with every previously-allowed value kept (additive only) plus the one new
-- value. The API tolerates a failed log insert on this path, so the assistant never depends on this
-- migration having been applied yet.
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
    'photo_analysis',
    'translation',
    'repair_assist'
  )
);
