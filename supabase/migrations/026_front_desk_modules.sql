-- Add front_desk_modules to tenants
-- Stores which nav modules are enabled for front_desk role (GM-configurable)
-- Default matches the hardcoded front_desk nav before this feature was added.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS front_desk_modules jsonb NOT NULL DEFAULT '["housekeeping","guest-requests","lost-found","tasks","logbook"]'::jsonb;
