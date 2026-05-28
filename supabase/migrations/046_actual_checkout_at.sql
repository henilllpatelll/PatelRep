-- Track when a departure guest actually left the room.
-- room_status.checkout_time remains the scheduled checkout/departure time.
ALTER TABLE room_status
  ADD COLUMN IF NOT EXISTS actual_checkout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_room_status_tenant_actual_checkout
  ON room_status (tenant_id, actual_checkout_at)
  WHERE actual_checkout_at IS NOT NULL;
