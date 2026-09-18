-- =============================================================================
-- Migration 106: Room assignment walking-order sequencing
-- Adds sequence_order to room_assignments so the AI auto-assign suggester
-- can persist the optimized visiting order (floor-walk minimization) it
-- computes per housekeeper, and the board/my-rooms views can render rooms
-- in that order instead of raw insertion order.
-- =============================================================================

ALTER TABLE room_assignments ADD COLUMN IF NOT EXISTS sequence_order INT;

COMMENT ON COLUMN room_assignments.sequence_order IS
  'Optimized visiting order (1-based) within a housekeeper''s assigned rooms for the day, minimizing floor/building walking. NULL when the assignment was not sequenced (e.g. manual board edit).';
