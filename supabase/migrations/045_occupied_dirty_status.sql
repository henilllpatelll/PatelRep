-- Add OCCUPIED to room_status.status CHECK constraint.
-- OCCUPIED = dirty room with a guest currently checked in (fo_status = OCC).
ALTER TABLE room_status
  DROP CONSTRAINT IF EXISTS room_status_status_check;

ALTER TABLE room_status
  ADD CONSTRAINT room_status_status_check CHECK (status IN (
    'DIRTY',
    'IN_PROGRESS',
    'CLEAN',
    'INSPECTED',
    'OOO',
    'PICKUP',
    'OCCUPIED'
  ));
