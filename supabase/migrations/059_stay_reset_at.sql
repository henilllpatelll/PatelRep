-- 059_stay_reset_at.sql
-- Records when housekeeping history was last reset for a room.
-- Set to NOW() when a DEP (departure) room is inspected and passes.
-- All housekeeping history queries use this as their lower-bound so notes
-- from prior guest stays do not bleed into the current stay.
-- Engineering history lives in work_orders (separate table) and is unaffected.

ALTER TABLE room_status ADD COLUMN IF NOT EXISTS stay_reset_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN room_status.stay_reset_at IS
  'Timestamp of last DEP inspection pass. Housekeeping history older than this is hidden (prior-stay isolation). NULL = no reset yet, show all history.';
