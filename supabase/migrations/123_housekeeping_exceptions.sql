-- Phase 8 (housekeeping redesign): structured Rush/priority metadata, DND
-- attempts, service-declined reason, and occupancy-discrepancy workflow.
-- Reuses the existing room_status.priority column (migration 004, "1 =
-- highest ... drives AI sort order") as the Rush trigger instead of adding a
-- parallel boolean -- deriveRoomAttentionItems() in roomState.ts already
-- treats priority <= 2 as Rush, so no frontend detection logic changes.
-- dnd_flag/do_not_service (migration 004) remain the booleans mobile already
-- toggles via PATCH /rooms/{id}/dnd and /decline-service; the columns below
-- are additive metadata only.

ALTER TABLE public.room_status
  ADD COLUMN IF NOT EXISTS dnd_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dnd_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dnd_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dnd_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_declined_reason TEXT,
  ADD COLUMN IF NOT EXISTS service_declined_note TEXT,
  ADD COLUMN IF NOT EXISTS service_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_declined_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_reason TEXT,
  ADD COLUMN IF NOT EXISTS priority_needed_by TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority_note TEXT,
  ADD COLUMN IF NOT EXISTS priority_set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.room_status.dnd_started_at IS 'Set when dnd_flag flips true; anchors the welfare-escalation clock (fixes the prior updated_at proxy, which reset on any unrelated room_status write).';
COMMENT ON COLUMN public.room_status.dnd_retry_at IS 'Next/return attempt time from the most recent service attempt (return_later result) or manual Return Later action.';
COMMENT ON COLUMN public.room_status.priority_reason IS 'Rush reason (early_arrival/vip/guest_waiting/front_desk_request/operational_priority/other); NULL when priority is not manually set.';

-- Append-only log of DND/service-attempt visits, independent of the current
-- dnd_flag/dnd_retry_at snapshot on room_status.
CREATE TABLE public.room_service_attempts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id        UUID        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  result         TEXT        NOT NULL CHECK (result IN ('dnd_no_response', 'return_later', 'guest_answered', 'dnd_cleared', 'other')),
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  return_at      TIMESTAMPTZ,
  note           TEXT,
  recorded_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_service_attempts_room ON public.room_service_attempts (tenant_id, room_id, attempted_at DESC);

-- Housekeeping-observed vs. PMS/front-desk occupancy discrepancy. Front Desk
-- resolves; housekeeping never writes room_status.fo_status directly from
-- this flow (PMS stays authoritative for occupancy).
CREATE TABLE public.room_occupancy_discrepancies (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  room_id                UUID        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  housekeeping_observed  TEXT        NOT NULL CHECK (housekeeping_observed IN ('occupied', 'vacant')),
  pms_status_at_report   TEXT,
  note                   TEXT,
  evidence               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reported_by            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reported_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                 TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution             TEXT        CHECK (resolution IN ('pms_confirmed', 'housekeeping_confirmed', 'guest_record_corrected', 'false_alarm', 'escalated')),
  resolution_note        TEXT,
  resolved_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_occupancy_discrepancies_open ON public.room_occupancy_discrepancies (tenant_id, status, room_id);
CREATE INDEX idx_room_occupancy_discrepancies_room ON public.room_occupancy_discrepancies (tenant_id, room_id, reported_at DESC);

ALTER TABLE public.room_service_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_occupancy_discrepancies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_room_service_attempts" ON public.room_service_attempts FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
CREATE POLICY "tenant_room_occupancy_discrepancies" ON public.room_occupancy_discrepancies FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Attempts are an append-only visit log; reuse the existing immutability
-- trigger function defined in migration 071.
CREATE TRIGGER room_service_attempts_immutable BEFORE UPDATE OR DELETE ON public.room_service_attempts FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();

ALTER TABLE public.room_service_attempts REPLICA IDENTITY FULL;
ALTER TABLE public.room_occupancy_discrepancies REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_occupancy_discrepancies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_occupancy_discrepancies;
  END IF;
END $$;
