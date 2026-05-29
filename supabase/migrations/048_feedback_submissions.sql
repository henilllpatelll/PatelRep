-- Store in-app staff feedback with automatic page/device context.
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role           TEXT        NOT NULL,
  category            TEXT        NOT NULL CHECK (category IN ('bug', 'confusing', 'missing_feature', 'too_slow', 'other')),
  severity            TEXT        NOT NULL CHECK (severity IN ('blocking', 'annoying', 'idea')),
  message             TEXT        NOT NULL CHECK (length(message) <= 2000),
  page_url            TEXT,
  pathname            TEXT,
  user_agent          TEXT,
  browser_language    TEXT,
  viewport_width      INT,
  viewport_height     INT,
  client_context      JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'closed')),
  notification_status TEXT        NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'failed', 'not_configured')),
  notification_error  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm_feedback_access" ON feedback_submissions;
CREATE POLICY "gm_feedback_access" ON feedback_submissions
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_tenant_created
  ON feedback_submissions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_tenant_status
  ON feedback_submissions (tenant_id, status, created_at DESC);
