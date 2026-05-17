-- =============================================================================
-- Migration 034: Opera OAuth state nonces
-- One-time server-side state records for Oracle OHIP OAuth callbacks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS opera_oauth_states (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nonce      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opera_oauth_states_nonce
  ON opera_oauth_states(nonce);

CREATE INDEX IF NOT EXISTS idx_opera_oauth_states_expiry
  ON opera_oauth_states(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE opera_oauth_states ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE opera_oauth_states IS 'One-time Oracle OHIP OAuth state nonces bound to a GM and tenant.';
