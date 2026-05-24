-- Track the Opera housekeeping task code for each daily room assignment.
-- DEP = departure clean, FULL = stayover full service with linen change,
-- LIGHT = stayover light service / pickup.

ALTER TABLE room_assignments
  ADD COLUMN IF NOT EXISTS clean_type TEXT NOT NULL DEFAULT 'DEP'
  CHECK (clean_type IN ('DEP', 'FULL', 'LIGHT'));

COMMENT ON COLUMN room_assignments.clean_type IS
  'Opera housekeeping task code for the assigned clean: DEP, FULL, or LIGHT.';
