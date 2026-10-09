-- Migration 208: structured linen counts on a clean session.
-- The mobile Linen Exchange sheet records dirty linens removed / fresh linens
-- placed per cleaning session. Forward-only and additive: nullable, no default,
-- so existing rows and the existing write paths are untouched. RLS is inherited
-- from room_clean_sessions (tenant_read / tenant policies from migration 055).

ALTER TABLE room_clean_sessions
  ADD COLUMN IF NOT EXISTS linen_counts jsonb NULL;

COMMENT ON COLUMN room_clean_sessions.linen_counts IS
  'Housekeeper-entered linen exchange for this session: {"dirty_out": int, "clean_in": int}. NULL = not recorded.';
