-- =============================================================================
-- Migration 003: Users, Roles & Departments
-- Staff profiles, RBAC roles, department definitions, and invitation flow
-- =============================================================================

-- ---------------------------------------------------------------------------
-- departments
-- Organizational departments within a hotel. Seeded per-tenant on onboarding.
-- ---------------------------------------------------------------------------
CREATE TABLE departments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,                -- e.g. "Housekeeping"
  code        TEXT        NOT NULL,                -- e.g. "HK"
  color       TEXT        NOT NULL DEFAULT '#4B5563', -- Tailwind gray-600 default
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE departments IS 'Hotel organizational departments. Standard codes: HK, ENG, FD, MGMT.';
COMMENT ON COLUMN departments.code IS 'Short unique code per tenant. Standard values: HK, ENG, FD, MGMT.';
COMMENT ON COLUMN departments.color IS 'Hex color used in UI for department badges and calendar events.';

-- ---------------------------------------------------------------------------
-- user_profiles
-- Extended profile data for each authenticated user. One row per user per
-- tenant (a user may belong to multiple tenants).
-- ---------------------------------------------------------------------------
CREATE TABLE user_profiles (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name       TEXT        NOT NULL,
  preferred_name  TEXT,                            -- "Goes by" name shown in UI
  phone           TEXT,
  employee_id     TEXT,                            -- Internal HR employee ID
  language_pref   TEXT        NOT NULL DEFAULT 'en', -- BCP-47 language tag
  avatar_url      TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  hire_date       DATE,
  expo_push_token TEXT,                            -- Expo push notification device token
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_profiles IS 'Extended staff profile linked to auth.users. One row per (user, tenant).';
COMMENT ON COLUMN user_profiles.expo_push_token IS 'Expo push notification token for mobile app. Updated on each app launch.';
COMMENT ON COLUMN user_profiles.language_pref IS 'BCP-47 language tag (e.g. "en", "es") for UI localization.';

-- ---------------------------------------------------------------------------
-- user_roles
-- Role assignments. A user may hold multiple roles (e.g. GM + Front Desk).
-- Roles are embedded in the JWT custom claims via a Supabase auth hook.
-- ---------------------------------------------------------------------------
CREATE TABLE user_roles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL CHECK (role IN (
                  'gm',
                  'housekeeping_supervisor',
                  'chief_engineer',
                  'front_desk',
                  'housekeeper',
                  'engineer'
                )),
  department_id UUID        REFERENCES departments(id) ON DELETE SET NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id, role)
);

COMMENT ON TABLE user_roles IS 'RBAC role assignments. Multiple roles per user supported. Roles populate JWT custom claims.';
COMMENT ON COLUMN user_roles.role IS 'One of: gm, housekeeping_supervisor, chief_engineer, front_desk, housekeeper, engineer.';

-- ---------------------------------------------------------------------------
-- staff_invitations
-- Token-based email invitations for onboarding new staff without requiring
-- an admin to manually create accounts.
-- ---------------------------------------------------------------------------
CREATE TABLE staff_invitations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL,
  role          TEXT        NOT NULL,
  department_id UUID        REFERENCES departments(id) ON DELETE SET NULL,
  invited_by    UUID        NOT NULL REFERENCES auth.users(id),
  token         TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at   TIMESTAMPTZ,                       -- NULL = pending, set on redemption
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staff_invitations IS 'Email invitation tokens for staff onboarding. Valid for 7 days by default.';
COMMENT ON COLUMN staff_invitations.token IS 'Secure random token sent in invitation link. Single-use.';
COMMENT ON COLUMN staff_invitations.accepted_at IS 'Timestamp of acceptance. NULL means invitation is still pending.';
