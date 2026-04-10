-- Phase 4: Custom role builder
-- GMs can create named roles with custom module permission sets per hotel.
-- base_role determines underlying RBAC; allowed_modules controls sidebar visibility.

CREATE TABLE IF NOT EXISTS custom_roles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  base_role       text        NOT NULL CHECK (base_role IN (
                                'housekeeper', 'engineer', 'housekeeping_supervisor',
                                'chief_engineer', 'front_desk', 'gm'
                              )),
  allowed_modules text[]      NOT NULL DEFAULT ARRAY[]::text[],
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, name)
);

CREATE INDEX IF NOT EXISTS custom_roles_hotel_idx
  ON custom_roles (hotel_id, is_active);
