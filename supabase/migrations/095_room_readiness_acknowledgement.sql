-- Migration 095: Room-readiness prediction acknowledgement (Phase 27, AI-05)
-- Adds supervisor/GM acknowledge-and-suppress capability to
-- room_readiness_predictions, mirroring failure_predictions.is_acknowledged.

ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE public.room_readiness_predictions ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.room_readiness_predictions.is_acknowledged IS
  'Set TRUE when a supervisor/GM manually acknowledges a HIGH-risk prediction, suppressing further auto-notification until risk clears and re-escalates (Phase 27, AI-05).';

-- ROLLBACK:
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN acknowledged_by;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN acknowledged_at;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN is_acknowledged;
