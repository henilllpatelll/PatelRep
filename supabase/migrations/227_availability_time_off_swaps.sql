-- =============================================================================
-- Migration 227: employee availability, time-off requests and two-way shift swaps
-- (Team Scheduling & Shift Coverage V2, Phase 5)
-- =============================================================================
-- Persistence for the workflows declared in services/scheduling_contracts.py:
--   employee_availability   what an employee SAYS they can work: weekly windows + date exceptions. Evidence only.
--   time_off_requests       a leave request. APPROVED leave is an enforceable scheduling restriction (trigger below).
--   shift_swap_requests     "I give you X, you give me Y". Needs coworker acceptance AND supervisor approval.
--
-- Guarantees enforced HERE (not only in the API):
--   * a person cannot hold two live (pending/approved) leave requests that overlap (23P01, hint leave_overlap);
--   * a denied/cancelled leave request can never change state again (TO010);
--   * shift_assignments cannot be inserted/moved/re-assigned onto a window that overlaps APPROVED leave (TO001) --
--     this covers bulk create, edit, coverage fills and swaps alike. Approving leave over shifts that are ALREADY
--     scheduled never touches them: the conflict stays visible until a supervisor resolves it;
--   * a shift is in at most one live swap (SW011);
--   * approve_shift_swap() exchanges the two assignments, and records the swap + audit rows, in ONE transaction.
--
-- Not touched: hk_shift_sessions (attendance), room_assignments, staff_role_schedules (temporary role authorization),
-- and any existing shift_assignments row. Availability and leave never edit or delete a published shift.
--
-- migration-safety: additive
-- rollback-plan: remove the three triggers and their functions (shift_assignments leave guard, time_off_requests guard, shift_swap_requests guard), remove public.approve_shift_swap and public.replace_weekly_availability, then remove shift_swap_requests, time_off_requests and employee_availability (reverse of their foreign keys). No existing table or row is modified; the only change to shift_assignments is one added BEFORE trigger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Availability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_availability (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('weekly', 'exception')),
  weekday        smallint CHECK (weekday BETWEEN 0 AND 6),
  exception_date date,
  mode           text NOT NULL CHECK (mode IN ('available', 'unavailable')),
  windows        jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from date NOT NULL,
  effective_to   date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  revision       integer NOT NULL DEFAULT 1,
  note           text,
  version        integer NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  retired_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_availability_shape_check CHECK (
    (kind = 'weekly' AND weekday IS NOT NULL AND exception_date IS NULL)
    OR (kind = 'exception' AND exception_date IS NOT NULL AND weekday IS NULL)
  ),
  CONSTRAINT employee_availability_windows_check CHECK (
    CASE
      WHEN jsonb_typeof(windows) <> 'array' THEN false
      WHEN mode = 'available' THEN jsonb_array_length(windows) BETWEEN 1 AND 4
      ELSE jsonb_array_length(windows) = 0
    END
  ),
  CONSTRAINT employee_availability_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
COMMENT ON TABLE public.employee_availability IS
  'What an employee says they can work. Evidence for scheduling, never attendance, never approved leave. No row for a day means UNKNOWN, not available.';
COMMENT ON COLUMN public.employee_availability.windows IS
  'Array of {"start":"HH:MM","end":"HH:MM"} hotel-local wall-clock windows; end <= start means the window runs past midnight into the next day.';
COMMENT ON COLUMN public.employee_availability.weekday IS '0 = Monday ... 6 = Sunday.';
COMMENT ON COLUMN public.employee_availability.revision IS
  'Weekly rows are written as one set; every row of a set shares its revision. The API sends the revision it read and a stale one is refused (AV001).';

-- One live weekly rule per person, weekday and start date; one live exception per person and date.
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_weekly_active
  ON public.employee_availability (tenant_id, user_id, weekday, effective_from)
  WHERE kind = 'weekly' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_exception_active
  ON public.employee_availability (tenant_id, user_id, exception_date)
  WHERE kind = 'exception' AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_availability_user ON public.employee_availability (tenant_id, user_id, status);

-- Replace the person's weekly availability as one atomic set effective from p_effective_from.
--   * live rows that start on/after the date are retired (superseded);
--   * live rows that started earlier are end-dated the day before (history is kept, they stay readable);
--   * the new rows are inserted. A weekday missing from p_days becomes "no availability submitted" from that date.
-- Errors: AV001 = the person's availability changed since the caller read it.
CREATE OR REPLACE FUNCTION public.replace_weekly_availability(
  p_tenant_id         uuid,
  p_user_id           uuid,
  p_actor             uuid,
  p_expected_revision integer,
  p_effective_from    date,
  p_days              jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_revision integer;
  v_day      jsonb;
  v_count    integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('employee_availability:' || p_user_id::text, 0));
  SELECT COALESCE(MAX(revision), 0) INTO v_revision
    FROM public.employee_availability
   WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND kind = 'weekly';
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'availability changed' USING ERRCODE = 'AV001';
  END IF;

  UPDATE public.employee_availability
     SET status = 'retired', retired_by = p_actor, retired_at = now(), version = version + 1, updated_at = now()
   WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND kind = 'weekly' AND status = 'active'
     AND effective_from >= p_effective_from;

  UPDATE public.employee_availability
     SET effective_to = p_effective_from - 1, version = version + 1, updated_at = now()
   WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND kind = 'weekly' AND status = 'active'
     AND effective_from < p_effective_from
     AND (effective_to IS NULL OR effective_to >= p_effective_from);

  FOR v_day IN SELECT * FROM jsonb_array_elements(p_days) LOOP
    INSERT INTO public.employee_availability (
      tenant_id, user_id, kind, weekday, mode, windows, effective_from, revision, note, created_by
    ) VALUES (
      p_tenant_id, p_user_id, 'weekly', (v_day->>'weekday')::smallint, v_day->>'mode',
      COALESCE(v_day->'windows', '[]'::jsonb), p_effective_from, v_revision + 1, v_day->>'note', p_actor
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('revision', v_revision + 1, 'days', v_count);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Time-off requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id   uuid,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  partial         boolean NOT NULL DEFAULT false,
  start_time      time,
  end_time        time,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason_category text NOT NULL CHECK (reason_category IN ('vacation', 'personal', 'family', 'appointment', 'health', 'other')),
  note            text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_reason text,
  cancelled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at    timestamptz,
  cancel_reason   text,
  idempotency_key text,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_requests_dates_check CHECK (end_date >= start_date),
  CONSTRAINT time_off_requests_window_check CHECK (ends_at > starts_at),
  CONSTRAINT time_off_requests_partial_check CHECK (
    (partial AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time <> end_time) OR (NOT partial)
  ),
  CONSTRAINT time_off_requests_denial_check CHECK (status <> 'denied' OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0))
);
COMMENT ON TABLE public.time_off_requests IS
  'A leave request. starts_at/ends_at are the resolved UTC window (whole local days, or the partial-day times). pending never changes a schedule; approved blocks new/moved shifts in that window and leaves already-scheduled shifts visible as conflicts.';
COMMENT ON COLUMN public.time_off_requests.note IS
  'Employee note, visible to the employee and the managers who decide the request. Reason categories exist so no one has to describe a health matter.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_time_off_idempotency
  ON public.time_off_requests (tenant_id, user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_time_off_tenant_status ON public.time_off_requests (tenant_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_time_off_user_window ON public.time_off_requests (tenant_id, user_id, status, starts_at);

CREATE OR REPLACE FUNCTION public.time_off_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('denied', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a % time-off request cannot change state', OLD.status USING ERRCODE = 'TO010';
  END IF;
  IF NEW.status IN ('pending', 'approved')
     AND (TG_OP = 'INSERT'
          OR (NEW.status, NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.status, OLD.starts_at, OLD.ends_at)) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('time_off_requests:' || NEW.user_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.time_off_requests o
       WHERE o.tenant_id = NEW.tenant_id AND o.user_id = NEW.user_id AND o.id <> NEW.id
         AND o.status IN ('pending', 'approved')
         AND o.starts_at < NEW.ends_at AND o.ends_at > NEW.starts_at
    ) THEN
      RAISE EXCEPTION 'time-off request overlaps another live request for user %', NEW.user_id
        USING ERRCODE = '23P01', HINT = 'leave_overlap';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_time_off_requests_guard ON public.time_off_requests;
CREATE TRIGGER trg_time_off_requests_guard
  BEFORE INSERT OR UPDATE OF status, starts_at, ends_at ON public.time_off_requests
  FOR EACH ROW EXECUTE FUNCTION public.time_off_requests_guard();

-- Approved leave is an enforceable restriction: no shift can be created on, moved onto, or handed to a person inside
-- an approved window. Only changes to WHO / WHEN / state re-run the check, so a notes edit on a shift that already
-- overlaps (approved afterwards) is not blocked and the existing shift stays visible for a supervisor to resolve.
-- Named so it fires AFTER trg_shift_assignments_before_write (which fills starts_at/ends_at on legacy inserts).
CREATE OR REPLACE FUNCTION public.shift_assignments_leave_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.publication_state = 'cancelled' OR NEW.starts_at IS NULL OR NEW.ends_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.user_id, NEW.starts_at, NEW.ends_at, NEW.publication_state)
         IS NOT DISTINCT FROM (OLD.user_id, OLD.starts_at, OLD.ends_at, OLD.publication_state) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.time_off_requests t
     WHERE t.tenant_id = NEW.tenant_id AND t.user_id = NEW.user_id AND t.status = 'approved'
       AND t.starts_at < NEW.ends_at AND t.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'approved time off overlaps this shift for user %', NEW.user_id
      USING ERRCODE = 'TO001', HINT = 'approved_time_off';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_assignments_leave_guard ON public.shift_assignments;
CREATE TRIGGER trg_shift_assignments_leave_guard
  BEFORE INSERT OR UPDATE OF user_id, starts_at, ends_at, publication_state ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.shift_assignments_leave_guard();

-- ---------------------------------------------------------------------------
-- 3. Shift swaps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_swap_requests (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id                 uuid,
  requester_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  counterpart_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_assignment_id       uuid NOT NULL REFERENCES public.shift_assignments(id) ON DELETE CASCADE,
  counterpart_assignment_id     uuid NOT NULL REFERENCES public.shift_assignments(id) ON DELETE CASCADE,
  requester_assignment_version  integer NOT NULL,
  counterpart_assignment_version integer NOT NULL,
  status                        text NOT NULL DEFAULT 'proposed'
                                CHECK (status IN ('proposed', 'accepted', 'declined', 'cancelled', 'expired', 'approved', 'denied')),
  note                          text,
  response_note                 text,
  responded_at                  timestamptz,
  decided_by                    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at                    timestamptz,
  decision_reason               text,
  cancelled_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason                 text,
  expires_at                    timestamptz NOT NULL,
  idempotency_key               text,
  version                       integer NOT NULL DEFAULT 1,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_swap_distinct_people_check CHECK (requester_id <> counterpart_id),
  CONSTRAINT shift_swap_distinct_shifts_check CHECK (requester_assignment_id <> counterpart_assignment_id),
  CONSTRAINT shift_swap_denial_check CHECK (status <> 'denied' OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0))
);
COMMENT ON TABLE public.shift_swap_requests IS
  'A two-way exchange: requester gives requester_assignment, counterpart gives counterpart_assignment. Coworker acceptance never changes the schedule; only approve_shift_swap() does, after a supervisor decides.';
COMMENT ON COLUMN public.shift_swap_requests.requester_assignment_version IS
  'The shift version both people agreed to. Approval refuses when either shift changed since (SW005).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_swap_idempotency
  ON public.shift_swap_requests (tenant_id, requester_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_swap_tenant_status ON public.shift_swap_requests (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_swap_requester ON public.shift_swap_requests (tenant_id, requester_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_counterpart ON public.shift_swap_requests (tenant_id, counterpart_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_req_assignment ON public.shift_swap_requests (requester_assignment_id);
CREATE INDEX IF NOT EXISTS idx_swap_cp_assignment ON public.shift_swap_requests (counterpart_assignment_id);

CREATE OR REPLACE FUNCTION public.shift_swap_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_first  uuid := LEAST(NEW.requester_assignment_id, NEW.counterpart_assignment_id);
  v_second uuid := GREATEST(NEW.requester_assignment_id, NEW.counterpart_assignment_id);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('declined', 'cancelled', 'expired', 'approved', 'denied')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a % swap request cannot change state', OLD.status USING ERRCODE = 'SW012';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status IN ('proposed', 'accepted') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('shift_swap:' || v_first::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('shift_swap:' || v_second::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.shift_swap_requests o
       WHERE o.id <> NEW.id AND o.status IN ('proposed', 'accepted')
         AND (o.requester_assignment_id IN (v_first, v_second) OR o.counterpart_assignment_id IN (v_first, v_second))
    ) THEN
      RAISE EXCEPTION 'one of these shifts is already part of a live swap request'
        USING ERRCODE = 'SW011', HINT = 'shift_in_live_swap';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shift_swap_requests_guard ON public.shift_swap_requests;
CREATE TRIGGER trg_shift_swap_requests_guard
  BEFORE INSERT OR UPDATE OF status ON public.shift_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.shift_swap_requests_guard();

-- The atomic exchange. Locks the request and BOTH shifts, re-validates everything, swaps the two employees, settles
-- the request and writes the audit rows -- or raises and changes nothing.
-- Errors: SW001 version conflict, SW002 not approvable (state), SW003 not found, SW004 a shift is gone,
-- SW005 a shift changed since both agreed, SW006 a shift already started / has attendance, SW007 someone is no
-- longer active, SW008 shifts are in different departments, SW009 the two shifts overlap each other,
-- SW010 a shift has a call-out on file. A hit on the overlap or approved-leave triggers (23P01 / TO001) also rolls
-- everything back.
CREATE OR REPLACE FUNCTION public.approve_shift_swap(
  p_tenant_id        uuid,
  p_swap_id          uuid,
  p_expected_version integer,
  p_actor            uuid,
  p_actor_role       text,
  p_note             text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_swap public.shift_swap_requests%ROWTYPE;
  v_a    public.shift_assignments%ROWTYPE;
  v_b    public.shift_assignments%ROWTYPE;
  v_lock uuid;
BEGIN
  SELECT * INTO v_swap FROM public.shift_swap_requests WHERE id = p_swap_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'swap not found' USING ERRCODE = 'SW003';
  END IF;
  IF v_swap.status <> 'accepted' THEN
    RAISE EXCEPTION 'swap is %', v_swap.status USING ERRCODE = 'SW002';
  END IF;
  IF v_swap.version <> p_expected_version THEN
    RAISE EXCEPTION 'swap changed' USING ERRCODE = 'SW001';
  END IF;

  PERFORM 1 FROM public.shift_assignments
   WHERE tenant_id = p_tenant_id AND id IN (v_swap.requester_assignment_id, v_swap.counterpart_assignment_id)
   ORDER BY id FOR UPDATE;
  SELECT * INTO v_a FROM public.shift_assignments WHERE id = v_swap.requester_assignment_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift missing' USING ERRCODE = 'SW004'; END IF;
  SELECT * INTO v_b FROM public.shift_assignments WHERE id = v_swap.counterpart_assignment_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift missing' USING ERRCODE = 'SW004'; END IF;

  IF v_a.version <> v_swap.requester_assignment_version OR v_b.version <> v_swap.counterpart_assignment_version
     OR v_a.user_id <> v_swap.requester_id OR v_b.user_id <> v_swap.counterpart_id
     OR v_a.publication_state <> 'published' OR v_b.publication_state <> 'published' THEN
    RAISE EXCEPTION 'a shift changed since the swap was agreed' USING ERRCODE = 'SW005';
  END IF;
  IF v_a.starts_at IS NULL OR v_b.starts_at IS NULL OR v_a.starts_at <= now() OR v_b.starts_at <= now()
     OR v_a.clocked_in_at IS NOT NULL OR v_b.clocked_in_at IS NOT NULL THEN
    RAISE EXCEPTION 'a shift has already started' USING ERRCODE = 'SW006';
  END IF;
  IF (SELECT COUNT(DISTINCT user_id) FROM public.user_roles
       WHERE tenant_id = p_tenant_id AND is_active AND user_id IN (v_swap.requester_id, v_swap.counterpart_id)) <> 2 THEN
    RAISE EXCEPTION 'an employee is no longer active' USING ERRCODE = 'SW007';
  END IF;
  IF v_a.department_id IS DISTINCT FROM v_b.department_id THEN
    RAISE EXCEPTION 'shifts are in different departments' USING ERRCODE = 'SW008';
  END IF;
  IF v_a.starts_at < v_b.ends_at AND v_b.starts_at < v_a.ends_at THEN
    RAISE EXCEPTION 'the two shifts overlap each other' USING ERRCODE = 'SW009';
  END IF;
  IF EXISTS (SELECT 1 FROM public.absence_records
              WHERE assignment_id IN (v_a.id, v_b.id) AND status IN ('reported', 'confirmed', 'covered')) THEN
    RAISE EXCEPTION 'a shift has a call-out on file' USING ERRCODE = 'SW010';
  END IF;

  -- Same lock key as the overlap trigger, taken in a fixed order so two swaps between the same people cannot deadlock.
  FOR v_lock IN SELECT u FROM unnest(ARRAY[v_swap.requester_id, v_swap.counterpart_id]) AS u ORDER BY u LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('shift_assignments:' || v_lock::text, 0));
  END LOOP;

  UPDATE public.shift_assignments SET user_id = v_swap.counterpart_id, updated_by = p_actor WHERE id = v_a.id;
  UPDATE public.shift_assignments SET user_id = v_swap.requester_id,   updated_by = p_actor WHERE id = v_b.id;

  UPDATE public.shift_swap_requests
     SET status = 'approved', decided_by = p_actor, decided_at = now(), decision_reason = p_note,
         version = version + 1, updated_at = now()
   WHERE id = v_swap.id;

  INSERT INTO public.operational_audit_events (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_note, source)
  VALUES
    (p_tenant_id, 'shift_swap', v_swap.id, 'approved', p_actor, p_actor_role,
     jsonb_build_object('status', 'accepted'), jsonb_build_object('status', 'approved'), p_note, 'api'),
    (p_tenant_id, 'shift_assignment', v_a.id, 'swapped', p_actor, p_actor_role,
     jsonb_build_object('user_id', v_a.user_id), jsonb_build_object('user_id', v_swap.counterpart_id, 'swap_id', v_swap.id), NULL, 'api'),
    (p_tenant_id, 'shift_assignment', v_b.id, 'swapped', p_actor, p_actor_role,
     jsonb_build_object('user_id', v_b.user_id), jsonb_build_object('user_id', v_swap.requester_id, 'swap_id', v_swap.id), NULL, 'api');

  RETURN jsonb_build_object('swap_id', v_swap.id, 'requester_assignment_id', v_a.id, 'counterpart_assignment_id', v_b.id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Access: service-role writes only (the API enforces tenant, ownership and role); no policy = no direct client access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_swap_requests   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.replace_weekly_availability(uuid, uuid, uuid, integer, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_weekly_availability(uuid, uuid, uuid, integer, date, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.approve_shift_swap(uuid, uuid, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_shift_swap(uuid, uuid, integer, uuid, text, text) TO service_role;
