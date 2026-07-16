-- Phase 0: Cron health tracking so /health can report last successful run per job.
CREATE TABLE IF NOT EXISTS public.cron_health (
  job_name TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_health IS
  'One row per scheduled job. Written by each cron endpoint on completion. No RLS — service-role only.';

-- Seed known jobs so the health endpoint always has a row to read.
INSERT INTO public.cron_health (job_name) VALUES
  ('predictions.run'),
  ('pm.check-due'),
  ('ai.failure-predictions'),
  ('billing.monthly-trueup'),
  ('logbook.shift-summary'),
  ('reports.daily-summary-email'),
  ('opera.sync-reservations'),
  ('escalations.check')
ON CONFLICT (job_name) DO NOTHING;
