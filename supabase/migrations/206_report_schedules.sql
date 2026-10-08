-- Reports redesign Phase 4: scheduled report delivery.
-- Purely additive (two new tables). Written/read only by the API (service role); RLS is the
-- second tenant-isolation layer. Report files are generated on demand and attached to the
-- email — nothing is stored, so there is no report-file retention surface.

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  report_type      TEXT NOT NULL CHECK (report_type IN (
                     'overview', 'guest-experience', 'housekeeping', 'maintenance', 'team', 'management'
                   )),
  frequency        TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week      SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),    -- Monday = 0; weekly only
  day_of_month     SMALLINT CHECK (day_of_month BETWEEN 1 AND 28),  -- monthly only (28 avoids short months)
  local_time       TIME NOT NULL,                                   -- hotel-local wall-clock delivery time
  timezone         TEXT NOT NULL,                                   -- IANA zone the schedule is evaluated in
  reporting_window TEXT NOT NULL CHECK (reporting_window IN ('previous_day', 'previous_7_days', 'previous_month')),
  output_format    TEXT NOT NULL CHECK (output_format IN ('pdf', 'csv')),
  recipient_ids    UUID[] NOT NULL DEFAULT '{}',
  filters          JSONB NOT NULL DEFAULT '{}'::jsonb,              -- e.g. {"department": "housekeeping", "include_definitions": true}
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at      TIMESTAMPTZ,                                     -- next due instant (UTC); NULL while paused
  last_run_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (frequency <> 'weekly' OR day_of_week IS NOT NULL),
  CHECK (frequency <> 'monthly' OR day_of_month IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_tenant ON public.report_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON public.report_schedules (next_run_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.report_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  schedule_id         UUID NOT NULL REFERENCES public.report_schedules(id) ON DELETE CASCADE,
  scheduled_occurrence TIMESTAMPTZ NOT NULL,                        -- the UTC instant this delivery was due
  idempotency_key     TEXT NOT NULL,                                -- "<schedule_id>:<occurrence ISO>"
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued', 'sending', 'sent', 'failed', 'not_configured', 'skipped'
                      )),
  attempts            INTEGER NOT NULL DEFAULT 0,
  recipient_count     INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  error_summary       TEXT,                                         -- sanitized; never provider credentials or email bodies
  next_retry_at       TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key),
  UNIQUE (schedule_id, scheduled_occurrence)
);

CREATE INDEX IF NOT EXISTS idx_report_deliveries_schedule ON public.report_deliveries (tenant_id, schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_retry ON public.report_deliveries (next_retry_at) WHERE status = 'failed';

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_report_schedules" ON public.report_schedules FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_report_deliveries" ON public.report_deliveries FOR ALL
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

COMMENT ON TABLE public.report_schedules IS 'Recurring report deliveries evaluated in the hotel-local timezone. next_run_at is a derived UTC instant.';
COMMENT ON TABLE public.report_deliveries IS 'One row per schedule occurrence; the UNIQUE idempotency key makes concurrent workers and retries safe.';
