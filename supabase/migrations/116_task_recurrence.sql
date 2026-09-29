-- =============================================================================
-- Migration 116: Task Recurrence
-- Adds a recurring-task source for Internal Tasks, mirroring the proven
-- pm_schedules cadence model (migration 101, services/pm_schedules.py) rather
-- than inventing a new recurrence mechanism: interval_type/interval_days +
-- next_due_at, advanced by a daily cron. Guest Requests are never recurring
-- (see CreateGuestRequestRequest — no schedule_id there by design).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- task_schedules
-- The recurrence rule. Each due cycle generates exactly one tasks row (linked
-- via tasks.task_schedule_id) — the schedule itself is never shown on the
-- board. end_type bounds how long the rule keeps generating work.
-- ---------------------------------------------------------------------------
CREATE TABLE public.task_schedules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  title                TEXT        NOT NULL,
  description          TEXT,
  task_type            TEXT        NOT NULL CHECK (task_type IN (
                          'housekeeping', 'engineering', 'lost_found', 'general'
                        )),
  priority             TEXT        NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),
  room_id              UUID        REFERENCES public.rooms(id) ON DELETE SET NULL,
  location_text        TEXT,
  assigned_to          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  interval_type        TEXT        NOT NULL CHECK (interval_type IN ('daily', 'weekly', 'monthly', 'custom')),
  interval_days        INT         CHECK (interval_days IS NULL OR interval_days > 0),
  next_due_at          TIMESTAMPTZ NOT NULL,

  end_type             TEXT        NOT NULL DEFAULT 'never' CHECK (end_type IN ('never', 'count', 'date')),
  end_count            INT         CHECK (end_count IS NULL OR end_count > 0),
  end_date             DATE,
  occurrences_generated INT        NOT NULL DEFAULT 0,

  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by           UUID        NOT NULL REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_schedules IS 'Recurrence rule for Internal Tasks. Each due cycle generates one linked tasks row (tasks.task_schedule_id) — never shown on the board itself.';
COMMENT ON COLUMN public.task_schedules.interval_days IS 'Only used when interval_type = custom (repeat every N days).';
COMMENT ON COLUMN public.task_schedules.occurrences_generated IS 'Advanced by tasks.generate-recurring each time a task is generated; compared against end_count when end_type = count.';

CREATE INDEX idx_task_schedules_due ON public.task_schedules (tenant_id, next_due_at) WHERE is_active = TRUE;

ALTER TABLE public.task_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_task_schedules" ON public.task_schedules FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- tasks.task_schedule_id
-- Auditable link from a generated task back to the rule that created it.
-- Idempotency (no duplicate task per cycle) is enforced in application code
-- the same way pm_schedules does it: skip generation while an open task for
-- this schedule still exists (see services/task_schedules.py).
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_schedule_id UUID REFERENCES public.task_schedules(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_task_schedule ON public.tasks (task_schedule_id) WHERE task_schedule_id IS NOT NULL;
