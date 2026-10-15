-- migration-safety: destructive-reviewed
-- rollback-plan: DROP POLICY own_feedback_select; DROP INDEXES idx_feedback_submissions_client_request and idx_feedback_submissions_user_created; the three added columns are nullable/defaulted and may stay unused. The only DROP here replaces this migration's own policy.
-- Mobile "Report a problem" reuses feedback_submissions: record where a report came from, which part of the
-- app it is about, and a client request id so a retried submit never files the same report twice.
-- Additive only: existing web feedback rows and policies are untouched.
ALTER TABLE feedback_submissions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'mobile')),
  ADD COLUMN IF NOT EXISTS area TEXT CHECK (
    area IS NULL OR area IN ('assignments', 'tasks', 'housekeeping', 'inspections', 'work_orders', 'notifications', 'account', 'sync', 'other')
  ),
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

-- One report per (hotel, person, client request id); NULL ids (all web rows) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_submissions_client_request
  ON feedback_submissions (tenant_id, user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Own-report history (and the abuse cap) read by person, newest first.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_created
  ON feedback_submissions (tenant_id, user_id, created_at DESC);

-- A person may read their own reports in their own hotel. GMs keep gm_feedback_access.
DROP POLICY IF EXISTS "own_feedback_select" ON feedback_submissions;
CREATE POLICY "own_feedback_select" ON feedback_submissions
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND user_id = auth.uid()
  );
