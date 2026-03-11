-- =============================================================================
-- Migration 002: Tenants & Multi-Tenancy Foundation
-- Core tenant tables, groups, and Opera PMS credential storage
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tenants
-- Each row represents one hotel property using PatelRep.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  slug              TEXT        NOT NULL UNIQUE,       -- URL-safe identifier, e.g. "austin-test-suites"
  address           TEXT,
  city              TEXT,
  state             TEXT        DEFAULT 'TX',
  zip               TEXT,
  phone             TEXT,
  room_count        INT         NOT NULL DEFAULT 0,    -- kept in sync with rooms table count
  timezone          TEXT        NOT NULL DEFAULT 'America/Chicago',
  logo_url          TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  trial_ends_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS 'One row per hotel property. Primary tenancy boundary for all data isolation.';
COMMENT ON COLUMN tenants.slug IS 'URL-safe unique identifier used in subdomains and API routing.';
COMMENT ON COLUMN tenants.room_count IS 'Cached count of active rooms; also used for billing calculations.';

-- ---------------------------------------------------------------------------
-- tenant_groups
-- Multi-property management groups (e.g. "Patel Family Hotels LLC")
-- Enables group-level billing discounts and cross-property reporting.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_groups (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL,
  owner_user_id         UUID        NOT NULL REFERENCES auth.users(id),
  stripe_customer_id    TEXT,                          -- Stripe customer for group billing
  group_discount_pct    DECIMAL(5,2) DEFAULT 0,        -- e.g. 10.00 = 10% discount on base fee
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenant_groups IS 'Management group for multi-property operators. Enables group-level discounts.';
COMMENT ON COLUMN tenant_groups.group_discount_pct IS 'Percentage discount applied to base subscription fee for all member hotels.';

-- ---------------------------------------------------------------------------
-- tenant_group_memberships
-- Many-to-many join between tenants and groups.
-- A hotel can belong to at most one group in practice, but the schema allows
-- migration paths.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_group_memberships (
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id   UUID        NOT NULL REFERENCES tenant_groups(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, group_id)
);

COMMENT ON TABLE tenant_group_memberships IS 'Associates hotels with management groups.';

-- ---------------------------------------------------------------------------
-- opera_credentials
-- Stores Oracle Opera / OHIP OAuth tokens for each hotel.
-- Tokens are stored encrypted using pgcrypto; decrypt in Edge Functions only.
-- ---------------------------------------------------------------------------
CREATE TABLE opera_credentials (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- Tokens stored as pgcrypto-encrypted ciphertext; decrypt only in trusted server context
  access_token      TEXT,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  ohip_base_url     TEXT,                              -- e.g. "https://ohip.oracle.com/v1"
  hotel_id_opera    TEXT,                              -- Opera internal hotel code
  is_connected      BOOLEAN     NOT NULL DEFAULT FALSE,
  last_sync_at      TIMESTAMPTZ,
  webhook_secret    TEXT,                              -- HMAC secret for validating Opera webhooks
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE opera_credentials IS 'Opera PMS / OHIP OAuth credentials per hotel. Tokens stored encrypted.';
COMMENT ON COLUMN opera_credentials.access_token IS 'pgcrypto-encrypted OHIP access token. Decrypt only in server-side Edge Functions.';
COMMENT ON COLUMN opera_credentials.refresh_token IS 'pgcrypto-encrypted OHIP refresh token. Decrypt only in server-side Edge Functions.';
COMMENT ON COLUMN opera_credentials.webhook_secret IS 'Shared HMAC-SHA256 secret for validating inbound Opera webhook payloads.';
