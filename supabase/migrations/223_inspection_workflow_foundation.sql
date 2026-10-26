-- =============================================================================
-- Migration 223: Supervisor inspection workflow foundation (additive only)
--
-- Phase 1 of the Supervisor Inspections redesign. Nothing here rewrites or
-- drops existing data, and every statement is idempotent.
--
--   * inspection_results.severity      minor | major, recorded per failed item
--   * inspection_template_items.allows_na
--                                      explicit per-item N/A policy (default true,
--                                      i.e. today's behaviour)
--   * inspections.correction_kind      touch_up | reclean (set only on failures)
--   * inspections.reinspection_of      the failed inspection this one re-checks
--   * inspections.template_fingerprint opaque digest of the checklist that was
--                                      actually shown, so a template edited
--                                      mid-inspection is detectable
--   * tasks.source_inspection_id       the correction task created for a failed
--                                      inspection; UNIQUE per inspection so a retry
--                                      can never create a second one
--   * guard_inspection_room_state()    serialises concurrent inspections of one
--                                      room under a row lock
--   * handle_inspection_complete()     a legacy "conditional" (touch-up) result no
--                                      longer releases the room: it blocks it (DIRTY)
--                                      exactly like a failure, so no result with an
--                                      outstanding defect can mark a room INSPECTED
--
-- inspections.id itself is the client-supplied submission id on the completion
-- endpoint (same pattern as tasks / work orders), so no extra idempotency
-- column is needed.
-- =============================================================================

ALTER TABLE public.inspection_results
  ADD COLUMN IF NOT EXISTS severity TEXT
    CONSTRAINT inspection_results_severity_check CHECK (severity IS NULL OR severity IN ('minor', 'major'));

COMMENT ON COLUMN public.inspection_results.severity IS
  'Only meaningful when result = fail. NULL = not classified (treated as major). minor items may qualify the failure as a touch-up; either way the room stays blocked until a passing reinspection.';

ALTER TABLE public.inspection_template_items
  ADD COLUMN IF NOT EXISTS allows_na BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.inspection_template_items.allows_na IS
  'When false, this item must be answered pass or fail; N/A is rejected. Default true preserves behaviour from before this column existed.';

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS correction_kind TEXT
    CONSTRAINT inspections_correction_kind_check CHECK (correction_kind IS NULL OR correction_kind IN ('touch_up', 'reclean')),
  ADD COLUMN IF NOT EXISTS reinspection_of UUID REFERENCES public.inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_fingerprint TEXT;

COMMENT ON COLUMN public.inspections.correction_kind IS
  'touch_up | reclean on failed inspections written by the validated completion endpoint; NULL on passes and on historical rows.';
COMMENT ON COLUMN public.inspections.reinspection_of IS
  'The failed inspection this inspection re-checks. Set by the server from the room''s open correction, never trusted from the client alone.';
COMMENT ON COLUMN public.inspections.template_fingerprint IS
  'Opaque digest of the checklist (ids, wording, order, required/photo/N-A flags) the inspector worked from. NULL on historical rows.';

CREATE INDEX IF NOT EXISTS idx_inspections_reinspection_of
  ON public.inspections (reinspection_of)
  WHERE reinspection_of IS NOT NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_inspection_id UUID REFERENCES public.inspections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.source_inspection_id IS
  'The failed inspection a correction task was created for. At most one task per inspection (unique index), so repeated retries cannot duplicate the correction.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_source_inspection
  ON public.tasks (tenant_id, source_inspection_id)
  WHERE source_inspection_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Concurrency guard.
--
-- The API checks that a room is CLEAN before it inserts an inspection, but two
-- supervisors can both pass that check. This BEFORE INSERT trigger re-checks
-- under a row lock: the second inserter waits for the first transaction, then
-- sees the room already INSPECTED / DIRTY and is rejected. The existing
-- AFTER INSERT trigger (handle_inspection_complete) still performs the status
-- transition, so room status handling is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_inspection_room_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT rs.status
    INTO v_status
    FROM public.room_status rs
   WHERE rs.room_id = NEW.room_id
     AND rs.tenant_id = NEW.tenant_id
     FOR UPDATE;

  IF v_status IS NULL OR v_status <> 'CLEAN' THEN
    RAISE EXCEPTION 'room_not_awaiting_inspection'
      USING ERRCODE = 'P0001',
            HINT = 'The room is no longer CLEAN; it was inspected or changed by someone else.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_inspection_room_state() IS
  'BEFORE INSERT guard on inspections: locks the room_status row and rejects the insert unless the room is still CLEAN. Makes "only one supervisor can inspect a clean room" race-safe.';

DROP TRIGGER IF EXISTS guard_inspection_room_state ON public.inspections;
CREATE TRIGGER guard_inspection_room_state
  BEFORE INSERT ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.guard_inspection_room_state();

-- ---------------------------------------------------------------------------
-- A "conditional" (minor touch-up) result used to move the room to INSPECTED,
-- i.e. release it with the defect still outstanding, relying on a prompt the
-- supervisor could dismiss. It now blocks the room exactly like a failure; the
-- API creates the matching touch-up correction. Only passes release a room.
-- Same signature, SECURITY INVOKER and search_path as migration 036.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_inspection_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.overall_result = 'passed' THEN
    UPDATE room_status SET
      status = 'INSPECTED', last_inspected_at = NOW(),
      last_inspected_by = NEW.inspected_by, updated_at = NOW()
    WHERE room_id = NEW.room_id;
  ELSIF NEW.overall_result IN ('failed', 'conditional') THEN
    UPDATE room_status SET status = 'DIRTY', updated_at = NOW()
    WHERE room_id = NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$;
