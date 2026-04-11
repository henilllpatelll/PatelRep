-- Phase 5: Assign custom roles to staff members
-- Adds a nullable custom_role_id FK on user_roles so a GM can assign
-- a custom role (with its allowed_modules set) to any staff member.

ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS custom_role_id uuid
    REFERENCES custom_roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_roles.custom_role_id IS
  'Optional custom role assignment. When set, the staff member''s sidebar '
  'uses allowed_modules from the referenced custom_roles row.';
