-- Drop the trigger that auto-writes room_status_history on every room_status UPDATE.
-- This trigger was creating duplicate history entries because the Python API layer
-- (rooms.py PATCH /rooms/{id}/status and housekeeping.py POST /inspections) also
-- writes history explicitly with the correct changed_by, notes, and change_source.
-- After this migration, history is the sole responsibility of the application layer.
DROP TRIGGER IF EXISTS on_room_status_change ON room_status;
