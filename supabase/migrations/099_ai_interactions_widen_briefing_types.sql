-- =============================================================================
-- Migration 099: Widen ai_interactions.interaction_type CHECK constraint
-- for the 4 new per-role mobile copilot briefing endpoints (Mobile Copilot
-- corner-card design import).
-- =============================================================================
-- Mirrors migration 091's pattern exactly. Adds supervisor_briefing,
-- engineer_briefing, front_desk_briefing, gm_briefing -- new interaction_type
-- values used by POST /v1/ai/supervisor/briefing, /engineer/briefing,
-- /front-desk/briefing and GET /v1/ai/gm/briefing. Additive only -- all 14
-- previously-allowed values are kept.
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
    'gm_briefing'
  )
);
