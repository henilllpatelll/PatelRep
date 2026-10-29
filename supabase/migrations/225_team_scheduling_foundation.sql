-- =============================================================================
-- Migration 225: scheduling data-integrity foundation
-- (Team Scheduling & Shift Coverage V2, Phase 1)
-- =============================================================================
-- WHAT WAS WRONG
--   * shift_assignments.shift_id was ON DELETE CASCADE: deleting a reusable shift template silently destroyed every
--     historical and published assignment that used it.
--   * An assignment held no times of its own -- it read the template's CURRENT start/end -- so editing a template
--     rewrote history and already-published schedules.
--   * Nothing stopped one person being scheduled on overlapping shifts (only UNIQUE(user_id, shift_id, work_date)),
--     and there was no version to detect two supervisors editing the same assignment.
--
-- WHAT THIS DOES (additive, except the one FK action change below)
--   1. shifts: archived_at/archived_by (soft removal), version + updated_at (optimistic concurrency), and a NOT VALID
--      CHECK that new templates have start_time <> end_time (existing rows are not rescanned or rejected).
--   2. shift_assignments: an immutable OCCURRENCE SNAPSHOT (shift_name, department_id, start_time, end_time,
--      starts_at, ends_at -- the instants are resolved in the hotel's timezone, overnight and DST included), plus
--      publication_state, version, notes and audit columns. The snapshot is copied from the template when the row is
--      created and is never refreshed from the template afterwards.
--   3. shift_assignments.shift_id -> ON DELETE NO ACTION: a template that is referenced can no longer be hard-deleted
--      (the API archives instead). NO ACTION, not RESTRICT, on purpose: it is checked at the end of the statement, so
--      deleting a whole tenant (which cascades to BOTH tables) still works, while `DELETE FROM shifts` of a referenced
--      template fails.
--   4. One BEFORE trigger: fills the snapshot for any insert that omits it, and serialises writes per employee under
--      a transaction advisory lock so two concurrent requests cannot both pass the overlap check (SQLSTATE 23P01).
--   5. Existing rows get their snapshot back-filled from the template as it is TODAY and are marked
--      snapshot_source = 'backfilled'. They are exempt from the overlap rule (history may legitimately contain
--      overlaps), but NEW rows are checked against them.
--
-- NOT TOUCHED: hk_shift_sessions (the attendance source of truth), room_assignments, the legacy clock-in columns on
-- shift_assignments (kept for the existing web consumer; no longer authoritative for attendance), every RLS policy.
--
-- migration-safety: destructive-reviewed
-- rollback-plan: the new columns, trigger, function, indexes and CHECKs are all droppable with no dependants: DROP TRIGGER trg_shift_assignments_before_write ON shift_assignments; DROP TRIGGER trg_shifts_before_update ON shifts; DROP FUNCTION shift_assignments_before_write(); DROP FUNCTION shifts_before_update(); then ALTER TABLE ... DROP COLUMN for the added columns. To restore the previous delete behaviour re-add shift_assignments_shift_id_fkey with ON DELETE CASCADE. The only DML is the NULL-filling back-fill UPDATE below; it overwrites nothing that was non-NULL, and the snapshot columns it fills did not exist before this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shift templates: soft removal + optimistic concurrency
-- ---------------------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version     integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_start_end_differ CHECK (start_time <> end_time) NOT VALID;

COMMENT ON COLUMN public.shifts.archived_at IS
  'Soft removal. An archived template cannot be scheduled again but every assignment that used it is untouched. Never hard-delete a referenced template.';
COMMENT ON COLUMN public.shifts.version IS
  'Bumped on every change to the template; clients send it back (expected_version) so concurrent edits are detected instead of overwritten.';

CREATE OR REPLACE FUNCTION public.shifts_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF (NEW.name, NEW.start_time, NEW.end_time, NEW.is_active, NEW.archived_at, NEW.department_id)
     IS DISTINCT FROM
     (OLD.name, OLD.start_time, OLD.end_time, OLD.is_active, OLD.archived_at, OLD.department_id) THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shifts_before_update ON public.shifts;
CREATE TRIGGER trg_shifts_before_update
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_before_update();

-- ---------------------------------------------------------------------------
-- 2. Assignments: immutable occurrence snapshot + lifecycle + versioning
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_assignments
  ADD COLUMN IF NOT EXISTS shift_name        text,
  ADD COLUMN IF NOT EXISTS department_id     uuid,
  ADD COLUMN IF NOT EXISTS start_time        time,
  ADD COLUMN IF NOT EXISTS end_time          time,
  ADD COLUMN IF NOT EXISTS starts_at         timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at           timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_source   text        NOT NULL DEFAULT 'occurrence',
  ADD COLUMN IF NOT EXISTS publication_state text        NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS version           integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notes             text,
  ADD COLUMN IF NOT EXISTS created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.shift_assignments
  ADD CONSTRAINT shift_assignments_snapshot_source_check
    CHECK (snapshot_source IN ('occurrence', 'backfilled')),
  ADD CONSTRAINT shift_assignments_publication_state_check
    CHECK (publication_state IN ('draft', 'published', 'cancelled')),
  ADD CONSTRAINT shift_assignments_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

COMMENT ON COLUMN public.shift_assignments.start_time IS
  'Hotel-local wall-clock start of THIS occurrence, copied from the template at creation (or set by an explicit edit). Never re-read from shifts.';
COMMENT ON COLUMN public.shift_assignments.starts_at IS
  'UTC instant of the occurrence start, resolved in the hotel timezone for work_date. ends_at is the next calendar day when end_time <= start_time (overnight).';
COMMENT ON COLUMN public.shift_assignments.snapshot_source IS
  'occurrence = written by the scheduling write path; backfilled = copied from the template by migration 225 for a pre-existing row.';
COMMENT ON COLUMN public.shift_assignments.publication_state IS
  'draft | published | cancelled. Phase 1 only writes published; draft/cancelled are reserved for the draft-versus-published workflow.';
COMMENT ON COLUMN public.shift_assignments.is_on_shift IS
  'LEGACY clock state kept for the existing web consumer. Not authoritative: actual attendance is hk_shift_sessions.';

CREATE INDEX IF NOT EXISTS idx_shift_assignments_tenant_user_starts
  ON public.shift_assignments (tenant_id, user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_tenant_starts
  ON public.shift_assignments (tenant_id, starts_at);

-- ---------------------------------------------------------------------------
-- 3. A referenced template can no longer be hard-deleted
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_assignments
  DROP CONSTRAINT IF EXISTS shift_assignments_shift_id_fkey;
ALTER TABLE public.shift_assignments
  ADD CONSTRAINT shift_assignments_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE NO ACTION;

-- ---------------------------------------------------------------------------
-- 4. Snapshot fill + per-employee serialised overlap check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_assignments_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tpl  public.shifts%ROWTYPE;
  v_tz   text;
BEGIN
  -- The migration's own back-fill (starts_at NULL -> value, marked 'backfilled') is exempt: it is not a scheduling
  -- decision. Any LATER edit of such a row has a non-NULL OLD.starts_at and is treated like any other edit.
  IF TG_OP = 'UPDATE' AND OLD.starts_at IS NULL AND NEW.snapshot_source = 'backfilled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Any insert that did not bring its own occurrence (legacy callers) gets one from the template, once.
    IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
      SELECT * INTO v_tpl FROM public.shifts WHERE id = NEW.shift_id;
      SELECT COALESCE(NULLIF(t.timezone, ''), 'America/Chicago') INTO v_tz FROM public.tenants t WHERE t.id = NEW.tenant_id;
      v_tz := COALESCE(v_tz, 'America/Chicago');
      NEW.shift_name    := COALESCE(NEW.shift_name, v_tpl.name);
      NEW.department_id := COALESCE(NEW.department_id, v_tpl.department_id);
      NEW.start_time    := COALESCE(NEW.start_time, v_tpl.start_time);
      NEW.end_time      := COALESCE(NEW.end_time, v_tpl.end_time);
      NEW.starts_at     := (NEW.work_date + NEW.start_time) AT TIME ZONE v_tz;
      NEW.ends_at       := (NEW.work_date + (CASE WHEN NEW.end_time <= NEW.start_time THEN 1 ELSE 0 END) + NEW.end_time)
                           AT TIME ZONE v_tz;
    END IF;
  ELSIF (NEW.user_id, NEW.shift_id, NEW.work_date, NEW.start_time, NEW.end_time, NEW.notes, NEW.publication_state)
        IS DISTINCT FROM
        (OLD.user_id, OLD.shift_id, OLD.work_date, OLD.start_time, OLD.end_time, OLD.notes, OLD.publication_state) THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;

  -- Overlap: serialise per employee, then look at everything already committed for them.
  -- (On UPDATE only when the person, the window or the state changed, so a notes-only edit of a legacy row that
  -- already overlaps another legacy row is not blocked.)
  IF NEW.publication_state <> 'cancelled' AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR (NEW.user_id, NEW.starts_at, NEW.ends_at, NEW.publication_state)
             IS DISTINCT FROM (OLD.user_id, OLD.starts_at, OLD.ends_at, OLD.publication_state)) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('shift_assignments:' || NEW.user_id::text, 0));
    IF EXISTS (
      SELECT 1
        FROM public.shift_assignments o
       WHERE o.user_id = NEW.user_id
         AND o.id <> NEW.id
         AND o.publication_state <> 'cancelled'
         AND o.starts_at IS NOT NULL
         AND o.starts_at < NEW.ends_at
         AND o.ends_at   > NEW.starts_at
    ) THEN
      RAISE EXCEPTION 'shift_assignments overlap for user %', NEW.user_id
        USING ERRCODE = '23P01', HINT = 'overlapping_shift';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Only changes to the schedule itself re-run the trigger on UPDATE: the legacy clock-in/out UPDATEs never do.
DROP TRIGGER IF EXISTS trg_shift_assignments_before_write ON public.shift_assignments;
CREATE TRIGGER trg_shift_assignments_before_write
  BEFORE INSERT OR UPDATE OF user_id, shift_id, work_date, start_time, end_time, starts_at, ends_at, notes, publication_state
  ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.shift_assignments_before_write();

-- ---------------------------------------------------------------------------
-- 5. Back-fill the snapshot for existing rows (fills NULLs only; marks them 'backfilled')
-- ---------------------------------------------------------------------------
UPDATE public.shift_assignments sa
   SET shift_name        = s.name,
       department_id     = s.department_id,
       start_time        = s.start_time,
       end_time          = s.end_time,
       starts_at         = (sa.work_date + s.start_time)
                           AT TIME ZONE COALESCE(NULLIF(t.timezone, ''), 'America/Chicago'),
       ends_at           = (sa.work_date + (CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)
                           AT TIME ZONE COALESCE(NULLIF(t.timezone, ''), 'America/Chicago'),
       snapshot_source   = 'backfilled'
  FROM public.shifts s
  JOIN public.tenants t ON t.id = s.tenant_id
 WHERE s.id = sa.shift_id
   AND sa.starts_at IS NULL;
