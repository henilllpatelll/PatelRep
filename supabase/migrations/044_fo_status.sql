-- Add fo_status to room_status for Opera occupancy tracking (OCC/VAC)
ALTER TABLE room_status
  ADD COLUMN IF NOT EXISTS fo_status TEXT
  CHECK (fo_status IN ('OCC', 'VAC'));
