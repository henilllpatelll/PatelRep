-- Housekeeper Tasks Phase 5: "Unable to Complete" blockers.
-- Purely additive (one new table + indexes). tasks.status is NOT changed: "blocked" is derived from
-- an active row here, so the escalation cron, web, and every other tasks consumer keep working.
-- Written/read only by the API (service role); RLS is the second tenant-isolation layer.

CREATE TABLE IF NOT EXISTS public.task_blockers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_id            UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reason             TEXT NOT NULL CHECK (reason IN (
                       'guest_unavailable', 'do_not_disturb', 'missing_supplies',
                       'access_issue', 'assistance_needed', 'equipment_issue', 'other'
                     )),
  details            TEXT CHECK (details IS NULL OR char_length(details) <= 1000),
  reported_by        UUID NOT NULL REFERENCES auth.users(id),
  reported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),   -- server clock, never client input
  client_request_id  UUID,                                  -- idempotency key for retried submissions
  -- Task context at the moment of the report (history survives later reassignment / status moves).
  task_status        TEXT NOT NULL,
  assigned_to        UUID,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  resolution         TEXT CHECK (resolution IN ('resumed', 'resolved', 'completed', 'reassigned')),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES auth.users(id),
  resolution_note    TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  -- What the supervisor alert actually did; never "sent" unless notification rows were written.
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN (
                       'pending', 'queued', 'failed', 'not_available'
                     )),
  notified_count     INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason <> 'other' OR (details IS NOT NULL AND char_length(btrim(details)) > 0)),
  CHECK ((status = 'active') = (resolved_at IS NULL)),
  CHECK ((status = 'active') = (resolution IS NULL))
);

COMMENT ON TABLE public.task_blockers IS 'Employee-reported reasons a task could not be completed. A task is "blocked" while it has an active row; the task status itself never changes.';

-- At most one unresolved blocker per task: concurrent or repeated reports collapse onto it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_blockers_one_active
  ON public.task_blockers (task_id) WHERE status = 'active';
-- A retried submission with the same key can never create a second row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_blockers_request
  ON public.task_blockers (tenant_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON public.task_blockers (task_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_blockers_active ON public.task_blockers (tenant_id, reported_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_task_blockers_reported_by ON public.task_blockers (reported_by);

ALTER TABLE public.task_blockers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON public.task_blockers
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);
