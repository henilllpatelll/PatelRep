-- =============================================================================
-- Migration 105: Shift Summary Acknowledgment
-- Adds a lightweight read-confirmation to AI shift-handover summaries (Phase 39).
-- Any authenticated oncoming staff member (supervisor, engineer, GM, ...) can
-- confirm they read the handoff; this is informational, NOT an SLA-enforced
-- escalation. Both columns nullable with no default: NULL = not yet
-- acknowledged, which is the normal initial state for every existing and new
-- shift_summaries row. Deleting the acknowledging user sets the reference back
-- to NULL rather than deleting the summary.
-- =============================================================================

ALTER TABLE public.shift_summaries
  ADD COLUMN acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.shift_summaries.acknowledged_by IS 'auth.users id of the staff member who confirmed they read this shift handoff. NULL = not yet acknowledged. Any authenticated role may set it (read-confirmation, not a privileged write). ON DELETE SET NULL.';
COMMENT ON COLUMN public.shift_summaries.acknowledged_at IS 'Timestamp the summary was acknowledged. NULL = not yet acknowledged. Set to now() together with acknowledged_by; idempotent re-acknowledge does not overwrite the original.';
