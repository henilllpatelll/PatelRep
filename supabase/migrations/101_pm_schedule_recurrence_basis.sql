-- =============================================================================
-- Migration 101: PM Schedule Recurrence Basis
-- Fixes pm.check-due generating a duplicate work order every day for the same
-- overdue schedule (next_due_at was never advanced after WO creation) and adds
-- the scheduled-date vs completion-date recurrence distinction: a fixed
-- calendar cadence advances the moment the WO is generated, while a
-- completion-driven cadence only advances when that WO is actually completed.
-- =============================================================================

ALTER TABLE pm_schedules
  ADD COLUMN IF NOT EXISTS recurrence_basis TEXT NOT NULL DEFAULT 'scheduled_date'
    CHECK (recurrence_basis IN ('scheduled_date', 'completion_date'));

COMMENT ON COLUMN pm_schedules.recurrence_basis IS
  'scheduled_date: next_due_at advances by the interval from the old due date as soon as the cron generates the WO (fixed calendar cadence). completion_date: next_due_at only advances once the generated work order is marked completed, measured from completion time.';
