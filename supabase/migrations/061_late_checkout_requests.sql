-- =============================================================================
-- Migration 061: Late Checkout Requests
-- Structured table for housekeepers to flag late checkout requests
-- that front desk staff can approve or deny with a confirmed time.
-- =============================================================================

CREATE TABLE late_checkout_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_id         UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  room_number     TEXT        NOT NULL,
  requested_by    UUID        NOT NULL REFERENCES auth.users(id),
  requested_time  TEXT        NOT NULL,   -- e.g. "1:00 PM" as entered by housekeeper
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'denied')),
  confirmed_time  TEXT,                   -- actual time front desk confirms (may differ)
  resolved_by     UUID        REFERENCES auth.users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE late_checkout_requests IS 'Housekeeper-reported late checkout requests pending front desk approval.';

CREATE INDEX idx_late_checkout_requests_tenant_status
  ON late_checkout_requests(tenant_id, status);

CREATE INDEX idx_late_checkout_requests_tenant_created
  ON late_checkout_requests(tenant_id, created_at DESC);

-- RLS
ALTER TABLE late_checkout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "late_checkout_requests_tenant_isolation"
  ON late_checkout_requests
  FOR ALL
  USING (tenant_id = (
    SELECT tenant_id FROM user_roles
    WHERE user_id = auth.uid() AND is_active = TRUE
    LIMIT 1
  ));
