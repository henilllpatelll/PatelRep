-- =============================================================================
-- Migration 020: Logbook entry expiry
-- Adds optional auto-expiry to logbook entries so time-sensitive notes
-- disappear automatically after a chosen duration.
-- =============================================================================

ALTER TABLE logbook_entries
  ADD COLUMN expires_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN logbook_entries.expires_at IS
  'When set, the entry is hidden (and eventually hard-deleted by cron) after this timestamp. NULL = permanent.';
