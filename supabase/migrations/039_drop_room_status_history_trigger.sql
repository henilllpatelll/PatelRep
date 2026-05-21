-- Migration 024 failed to apply to this database instance.
-- The on_room_status_change trigger causes duplicate room_status_history rows
-- because the Python API layer (rooms.py and housekeeping.py) also writes
-- history explicitly with the correct changed_by, notes, and change_source.
DROP TRIGGER IF EXISTS on_room_status_change ON room_status;
