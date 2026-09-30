-- Phase 10 (housekeeping redesign): the frontend (lib/housekeeping/roomState.ts
-- `recleanRequired`) has always read room_status.reclean_requested_at, but
-- nothing wrote it -- POST /housekeeping/inspections/{id}/reclean only ever
-- created a generic "Re-clean Room X" task, so the re-clean section of My
-- Rooms/Team Plan was permanently unreachable. This column plus the two
-- write sites in routers/housekeeping.py (submit_inspection clears it on a
-- pass, trigger_reclean sets it on a fail) make that workflow real.

ALTER TABLE public.room_status
  ADD COLUMN IF NOT EXISTS reclean_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.room_status.reclean_requested_at IS 'Set by POST /housekeeping/inspections/{id}/reclean after a failed/conditional inspection; cleared when the room next passes inspection. Drives recleanRequired in lib/housekeeping/roomState.ts.';
