-- Migration 096: Escalation watermark for HIGH-risk predictions (Phase 29, AI-12/13/14)
-- Single-tier: 0 = not escalated, 1 = GM notified. high_risk_since anchors the
-- 60-minute un-actioned clock (distinct from last_calculated_at/generated_at,
-- which are rewritten every prediction-engine run regardless of risk level).

ALTER TABLE public.room_readiness_predictions
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 1);
ALTER TABLE public.room_readiness_predictions
  ADD COLUMN IF NOT EXISTS high_risk_since TIMESTAMPTZ;

ALTER TABLE public.failure_predictions
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 1);
ALTER TABLE public.failure_predictions
  ADD COLUMN IF NOT EXISTS high_risk_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_room_readiness_escalation
  ON public.room_readiness_predictions (tenant_id, escalation_level, high_risk_since)
  WHERE risk_level = 'HIGH' AND is_acknowledged = FALSE;

CREATE INDEX IF NOT EXISTS idx_failure_predictions_escalation
  ON public.failure_predictions (tenant_id, escalation_level, high_risk_since)
  WHERE risk_score >= 70 AND is_acknowledged = FALSE;

COMMENT ON COLUMN public.room_readiness_predictions.escalation_level IS '0=none, 1=GM auto-escalated (Phase 29, AI-12)';
COMMENT ON COLUMN public.room_readiness_predictions.high_risk_since IS 'Timestamp the room first crossed into HIGH risk (unacknowledged); anchors the 60-min GM-escalation clock. NULL when not currently HIGH.';
COMMENT ON COLUMN public.failure_predictions.escalation_level IS '0=none, 1=GM auto-escalated (Phase 29, AI-12)';
COMMENT ON COLUMN public.failure_predictions.high_risk_since IS 'Timestamp the asset first crossed into HIGH risk (risk_score>=70, unacknowledged); anchors the 60-min GM-escalation clock. Carried forward across the delete-then-insert prediction rewrite while still HIGH. NULL when not currently HIGH.';

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_failure_predictions_escalation;
-- DROP INDEX IF EXISTS idx_room_readiness_escalation;
-- ALTER TABLE public.failure_predictions DROP COLUMN IF EXISTS high_risk_since;
-- ALTER TABLE public.failure_predictions DROP COLUMN IF EXISTS escalation_level;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN IF EXISTS high_risk_since;
-- ALTER TABLE public.room_readiness_predictions DROP COLUMN IF EXISTS escalation_level;
