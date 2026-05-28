-- Store imported Opera task-sheet clean type on live room status so unassigned
-- rooms can still show Departure / Full / Light on the room board.
ALTER TABLE room_status
  ADD COLUMN IF NOT EXISTS clean_type TEXT
  CHECK (clean_type IN ('DEP', 'FULL', 'LIGHT'));

COMMENT ON COLUMN room_status.clean_type IS
  'Latest Opera task sheet clean type for board display before/without assignment.';
