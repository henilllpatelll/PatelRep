-- =============================================================================
-- Migration 228: schedule revisions (draft -> published) and the schedule notification outbox
-- (Team Scheduling & Shift Coverage V2, Phase 7)
-- =============================================================================
-- A supervisor stages shift changes in a REVISION (a change set) instead of editing the live schedule. Nothing in
-- shift_assignments changes until publish_schedule_revision() applies the whole revision in ONE transaction, so:
--   * employees can never see a draft (it is not in shift_assignments; the API gives only managers a way to read it);
--   * a draft cancellation cannot delete a live shift, and a draft shift cannot trip the live overlap constraints;
--   * a half-applied revision is impossible: any failure rolls the whole publication back.
--
-- schedule_revisions         one row per revision; ONE open draft per (tenant, department). Published rows are immutable.
-- schedule_revision_changes  the proposed creates / edits / cancellations. One coherent result per shift: a second edit
--                            of the same shift replaces the first (unique per assignment / per client_key).
-- schedule_revision_events   append-only history (draft created/edited/discarded, publication succeeded/rejected, ...).
-- schedule_notifications     the TRANSACTIONAL OUTBOX required by the schedule_notification workflow (services/
--                            scheduling_contracts.py). publish_schedule_revision() writes the intents in the same
--                            transaction as the schedule; delivery is a separate, retryable step.
-- notifications.dedupe_key   makes creating the in-app inbox row from an outbox row idempotent.
--
-- publish_schedule_revision() applies cancels, then edits (a moved shift is parked as 'cancelled' for the length of the
-- transaction so a legitimate swap is not refused by an intermediate overlap), then creates. The existing triggers
-- (225 overlap, 227 approved leave) remain the final authority on every row. Attendance (hk_shift_sessions) and
-- historical rows are never touched.
--
-- Error codes raised (the API maps them): SR001 revision edited since review, SR002 already published/not a draft,
-- SR003 not found, SR004 discarded/superseded, SR005 a shift changed since the draft was made (DETAIL = change id),
-- SR006 shift has attendance, SR007 date in the past, SR008 call-out/coverage commitment on the shift, SR009 empty
-- revision, SR010 change outside the revision's department.
--
-- migration-safety: destructive-reviewed
-- Reviewed: the only constraint change is section 0 -- the plain UNIQUE (user_id, shift_id, work_date) of migration 005 becomes a
-- partial unique index that ignores 'cancelled' rows. It is strictly LOOSER for cancelled rows and identical for every other row
-- (no row can violate it that did not violate the old one), and nothing references the constraint by name or in ON CONFLICT.
-- Why: publishing a cancellation keeps the row (a hard delete would cascade-delete its absence and swap history, FKs in 226/227),
-- and a retained cancelled row must not stop the same person being scheduled on the same shift and date again, or two people
-- swapping the same shift while it is parked.
-- rollback-plan: restore UNIQUE (user_id, shift_id, work_date) on public.shift_assignments after confirming no cancelled duplicates exist, then remove public.publish_schedule_revision(uuid, uuid, integer, uuid, text, text) and public.claim_schedule_notifications(integer, uuid), then the guard triggers and their functions on the four new tables, then schedule_notifications, schedule_revision_events, schedule_revision_changes and schedule_revisions in that order (reverse of their foreign keys), and finally the notifications.dedupe_key column with its index. Published shifts written by past publications are ordinary shift_assignments rows and stay valid without these objects.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. A cancelled shift keeps its row (history) but must not occupy the (person, shift, date) slot
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_assignments DROP CONSTRAINT IF EXISTS shift_assignments_user_id_shift_id_work_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_assignments_live_person_shift_date
  ON public.shift_assignments (user_id, shift_id, work_date) WHERE publication_state <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 1. Revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_revisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id        uuid NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'discarded')),
  version              integer NOT NULL DEFAULT 1,
  corrects_revision_id uuid REFERENCES public.schedule_revisions(id) ON DELETE SET NULL,
  note                 text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  published_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  publication_key      text,
  result               jsonb,
  discarded_at         timestamptz,
  discarded_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.schedule_revisions IS
  'A manager''s staged set of schedule changes. Employees only ever see the published shift_assignments; a revision changes them only through publish_schedule_revision().';
COMMENT ON COLUMN public.schedule_revisions.version IS
  'Bumped on every edit of the draft. Publishing requires the version the supervisor reviewed (SR001 otherwise).';
COMMENT ON COLUMN public.schedule_revisions.result IS
  'Frozen publication outcome (counts, per-change versions). Written once by publish_schedule_revision().';

CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_revision_one_draft
  ON public.schedule_revisions (tenant_id, department_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_revision_publication_key
  ON public.schedule_revisions (tenant_id, publication_key) WHERE publication_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_revisions_history
  ON public.schedule_revisions (tenant_id, department_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_revisions_corrects
  ON public.schedule_revisions (corrects_revision_id) WHERE corrects_revision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Proposed changes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_revision_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revision_id   uuid NOT NULL REFERENCES public.schedule_revisions(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('create', 'update', 'cancel')),
  assignment_id uuid REFERENCES public.shift_assignments(id) ON DELETE SET NULL,
  client_key    text,
  base_version  integer,
  before        jsonb,
  proposed      jsonb,
  reason        text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_revision_changes_shape_check CHECK (
    (kind = 'create' AND client_key IS NOT NULL AND proposed IS NOT NULL)
    OR (kind = 'update' AND base_version IS NOT NULL AND proposed IS NOT NULL)
    OR (kind = 'cancel' AND base_version IS NOT NULL)
  )
);
COMMENT ON COLUMN public.schedule_revision_changes.before IS
  'The live shift as the supervisor saw it when staging the change (display only; the base_version compare is what protects against overwrites).';
COMMENT ON COLUMN public.schedule_revision_changes.reason IS
  'Manager-only free text. Never copied into an employee notification.';
-- One coherent result per shift: staging a second edit of the same shift replaces the first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_change_per_assignment
  ON public.schedule_revision_changes (revision_id, assignment_id) WHERE assignment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_change_client_key
  ON public.schedule_revision_changes (revision_id, client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revision_changes_assignment
  ON public.schedule_revision_changes (assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revision_changes_tenant
  ON public.schedule_revision_changes (tenant_id, revision_id);

-- ---------------------------------------------------------------------------
-- 3. Append-only revision history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_revision_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.schedule_revisions(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN (
                'draft_created', 'draft_edited', 'draft_discarded', 'publication_attempted', 'publication_succeeded',
                'publication_rejected', 'notification_queued', 'notification_sent', 'notification_failed',
                'notification_retried', 'corrective_published')),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revision_events_revision
  ON public.schedule_revision_events (tenant_id, revision_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Notification outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  dedupe_key      text NOT NULL,
  revision_id     uuid REFERENCES public.schedule_revisions(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  push_status     text NOT NULL DEFAULT 'not_attempted'
                  CHECK (push_status IN ('not_attempted', 'accepted', 'failed', 'no_device', 'opted_out', 'not_applicable')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
COMMENT ON TABLE public.schedule_notifications IS
  'Transactional outbox for schedule events. queued/failed rows are retried with backoff; sent means the in-app inbox row exists, NOT that a phone received anything (push_status records only what the provider said).';
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_notification_dedupe
  ON public.schedule_notifications (tenant_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_schedule_notifications_due
  ON public.schedule_notifications (next_attempt_at) WHERE status IN ('queued', 'failed', 'processing');
CREATE INDEX IF NOT EXISTS idx_schedule_notifications_revision
  ON public.schedule_notifications (tenant_id, revision_id) WHERE revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_notifications_user
  ON public.schedule_notifications (tenant_id, user_id, created_at DESC);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
  ON public.notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Immutability guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_revisions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN  -- a direct delete; a tenant cascade runs one level deeper and is allowed
      RAISE EXCEPTION 'schedule revisions are history and cannot be deleted' USING ERRCODE = 'SR004';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'discarded' THEN
    RAISE EXCEPTION 'a discarded revision cannot change' USING ERRCODE = 'SR004';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'a superseded revision cannot change' USING ERRCODE = 'SR004';
  END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'a published revision cannot be discarded or reopened' USING ERRCODE = 'SR002';
  END IF;
  IF OLD.status IN ('published', 'superseded')
     AND (NEW.tenant_id, NEW.department_id, NEW.result, NEW.published_at, NEW.published_by, NEW.publication_key, NEW.created_by, NEW.created_at, NEW.corrects_revision_id)
         IS DISTINCT FROM
         (OLD.tenant_id, OLD.department_id, OLD.result, OLD.published_at, OLD.published_by, OLD.publication_key, OLD.created_by, OLD.created_at, OLD.corrects_revision_id) THEN
    RAISE EXCEPTION 'a published revision is an immutable record' USING ERRCODE = 'SR002';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_schedule_revisions_guard ON public.schedule_revisions;
CREATE TRIGGER trg_schedule_revisions_guard
  BEFORE UPDATE OR DELETE ON public.schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION public.schedule_revisions_guard();

-- Changes belong to an open draft only. Direct deletes are refused once the revision is closed.
CREATE OR REPLACE FUNCTION public.schedule_revision_changes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_status text;
  v_rev    uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM public.schedule_revisions WHERE id = v_rev;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'only an open draft can change' USING ERRCODE = 'SR002';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_schedule_revision_changes_guard ON public.schedule_revision_changes;
CREATE TRIGGER trg_schedule_revision_changes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_revision_changes
  FOR EACH ROW EXECUTE FUNCTION public.schedule_revision_changes_guard();

CREATE OR REPLACE FUNCTION public.schedule_revision_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'revision history is append-only' USING ERRCODE = 'SR002';
END;
$function$;

DROP TRIGGER IF EXISTS trg_schedule_revision_events_guard ON public.schedule_revision_events;
CREATE TRIGGER trg_schedule_revision_events_guard
  BEFORE UPDATE OR DELETE ON public.schedule_revision_events
  FOR EACH ROW EXECUTE FUNCTION public.schedule_revision_events_guard();

-- ---------------------------------------------------------------------------
-- 6. Outbox claim (multi-replica safe, bounded)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_schedule_notifications(p_limit integer, p_revision_id uuid DEFAULT NULL)
RETURNS SETOF public.schedule_notifications
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT n.id FROM public.schedule_notifications n
     WHERE (n.status IN ('queued', 'failed') AND n.next_attempt_at <= now() AND n.attempts < 5
            OR n.status = 'processing' AND n.locked_until < now())
       AND (p_revision_id IS NULL OR n.revision_id = p_revision_id)
     ORDER BY n.next_attempt_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.schedule_notifications n
     SET status = 'processing', attempts = n.attempts + 1, locked_until = now() + interval '2 minutes'
    FROM due WHERE n.id = due.id
  RETURNING n.*;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Atomic publication
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_schedule_revision(
  p_tenant_id        uuid,
  p_revision_id      uuid,
  p_expected_version integer,
  p_actor            uuid,
  p_actor_role       text,
  p_idempotency_key  text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_rev       public.schedule_revisions%ROWTYPE;
  v_tz        text;
  v_today     date;
  c           record;
  a           public.shift_assignments%ROWTYPE;
  v_new       public.shift_assignments%ROWTYPE;
  v_events    jsonb := '[]'::jsonb;
  v_outcomes  jsonb := '[]'::jsonb;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_cancelled integer := 0;
  v_queued    integer := 0;
  v_people    integer := 0;
  v_moves     boolean;
  v_result    jsonb;
  v_count     integer;
BEGIN
  SELECT * INTO v_rev FROM public.schedule_revisions WHERE id = p_revision_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule revision not found' USING ERRCODE = 'SR003';
  END IF;
  -- A repeat of an already-committed publication returns what was committed (a lost response is recoverable).
  IF v_rev.status = 'published' AND p_idempotency_key IS NOT NULL AND v_rev.publication_key = p_idempotency_key THEN
    RETURN v_rev.result || jsonb_build_object('replayed', true);
  END IF;
  IF v_rev.status IN ('discarded', 'superseded') THEN
    RAISE EXCEPTION 'revision is %', v_rev.status USING ERRCODE = 'SR004';
  END IF;
  IF v_rev.status <> 'draft' THEN
    RAISE EXCEPTION 'revision is already published' USING ERRCODE = 'SR002';
  END IF;
  IF v_rev.version <> p_expected_version THEN
    RAISE EXCEPTION 'revision was edited after it was reviewed' USING ERRCODE = 'SR001';
  END IF;

  SELECT count(*) INTO v_count FROM public.schedule_revision_changes WHERE revision_id = v_rev.id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'nothing to publish' USING ERRCODE = 'SR009';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_revision_changes WHERE revision_id = v_rev.id AND department_id <> v_rev.department_id) THEN
    RAISE EXCEPTION 'a change is outside this revision''s department' USING ERRCODE = 'SR010';
  END IF;

  SELECT COALESCE(NULLIF(t.timezone, ''), 'America/Chicago') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'America/Chicago'))::date;

  -- Phase 0: lock + verify every existing shift the revision touches (stable order: no deadlock between publishers).
  FOR c IN
    SELECT * FROM public.schedule_revision_changes
     WHERE revision_id = v_rev.id AND kind IN ('update', 'cancel') ORDER BY assignment_id NULLS FIRST, id
  LOOP
    IF c.assignment_id IS NULL THEN
      RAISE EXCEPTION 'a shift in this draft no longer exists' USING ERRCODE = 'SR005', DETAIL = c.id::text;
    END IF;
    SELECT * INTO a FROM public.shift_assignments WHERE id = c.assignment_id AND tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND OR a.publication_state = 'cancelled' OR a.version <> c.base_version THEN
      RAISE EXCEPTION 'a shift changed after this draft was made' USING ERRCODE = 'SR005', DETAIL = c.id::text;
    END IF;
    IF a.department_id IS DISTINCT FROM v_rev.department_id THEN
      RAISE EXCEPTION 'a change is outside this revision''s department' USING ERRCODE = 'SR010', DETAIL = c.id::text;
    END IF;
    IF a.clocked_in_at IS NOT NULL OR COALESCE(a.is_on_shift, false)
       OR EXISTS (SELECT 1 FROM public.hk_shift_sessions s
                   WHERE s.tenant_id = p_tenant_id AND s.user_id = a.user_id
                     AND s.started_at >= a.starts_at - interval '6 hours' AND s.started_at < a.ends_at) THEN
      RAISE EXCEPTION 'this shift already has attendance' USING ERRCODE = 'SR006', DETAIL = c.id::text;
    END IF;
    IF a.work_date < v_today THEN
      RAISE EXCEPTION 'past shifts cannot be changed' USING ERRCODE = 'SR007', DETAIL = c.id::text;
    END IF;
    IF EXISTS (SELECT 1 FROM public.absence_records ar
                WHERE ar.assignment_id = a.id AND ar.status IN ('reported', 'confirmed', 'covered')) THEN
      RAISE EXCEPTION 'this shift has a call-out in progress' USING ERRCODE = 'SR008', DETAIL = c.id::text;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.schedule_revision_changes
              WHERE revision_id = v_rev.id AND kind = 'create' AND (proposed->>'work_date')::date < v_today) THEN
    RAISE EXCEPTION 'a new shift is dated in the past' USING ERRCODE = 'SR007';
  END IF;

  -- Phase 1: cancellations, and park every moved shift as 'cancelled' so intermediate overlaps cannot refuse a valid end state.
  FOR c IN
    SELECT * FROM public.schedule_revision_changes
     WHERE revision_id = v_rev.id AND kind IN ('update', 'cancel') ORDER BY assignment_id
  LOOP
    SELECT * INTO a FROM public.shift_assignments WHERE id = c.assignment_id;
    IF c.kind = 'cancel' THEN
      UPDATE public.shift_assignments SET publication_state = 'cancelled', updated_by = p_actor WHERE id = a.id
        RETURNING * INTO v_new;
      v_cancelled := v_cancelled + 1;
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'user_id', a.user_id, 'kind', 'cancelled', 'work_date', a.work_date, 'assignment_id', a.id));
      v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
        'change_id', c.id, 'kind', 'cancel', 'assignment_id', a.id, 'version', v_new.version));
      INSERT INTO public.operational_audit_events (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_note, source)
      VALUES (p_tenant_id, 'shift_assignment', a.id, 'cancelled', p_actor, p_actor_role,
              jsonb_build_object('user_id', a.user_id, 'work_date', a.work_date, 'start_time', a.start_time, 'end_time', a.end_time),
              jsonb_build_object('publication_state', 'cancelled', 'revision_id', v_rev.id), c.reason, 'api');
    ELSE
      v_moves := (c.proposed->>'user_id')::uuid IS DISTINCT FROM a.user_id
              OR (c.proposed->>'work_date')::date IS DISTINCT FROM a.work_date
              OR (c.proposed->>'starts_at')::timestamptz IS DISTINCT FROM a.starts_at
              OR (c.proposed->>'ends_at')::timestamptz IS DISTINCT FROM a.ends_at;
      IF v_moves THEN
        UPDATE public.shift_assignments SET publication_state = 'cancelled', updated_by = p_actor WHERE id = a.id;
      END IF;
    END IF;
  END LOOP;

  -- Phase 2: apply the edits.
  FOR c IN
    SELECT * FROM public.schedule_revision_changes WHERE revision_id = v_rev.id AND kind = 'update' ORDER BY assignment_id
  LOOP
    SELECT * INTO a FROM public.shift_assignments WHERE id = c.assignment_id;
    UPDATE public.shift_assignments SET
        user_id = (c.proposed->>'user_id')::uuid,
        shift_id = (c.proposed->>'shift_id')::uuid,
        shift_name = COALESCE(c.proposed->>'shift_name', a.shift_name),
        department_id = COALESCE((c.proposed->>'department_id')::uuid, a.department_id),
        work_date = (c.proposed->>'work_date')::date,
        start_time = (c.proposed->>'start_time')::time,
        end_time = (c.proposed->>'end_time')::time,
        starts_at = (c.proposed->>'starts_at')::timestamptz,
        ends_at = (c.proposed->>'ends_at')::timestamptz,
        notes = CASE WHEN c.proposed ? 'notes' THEN c.proposed->>'notes' ELSE a.notes END,
        snapshot_source = 'occurrence',
        publication_state = 'published',
        updated_by = p_actor
      WHERE id = a.id
      RETURNING * INTO v_new;
    v_updated := v_updated + 1;
    IF v_new.user_id IS DISTINCT FROM a.user_id THEN
      v_events := v_events || jsonb_build_array(
        jsonb_build_object('user_id', a.user_id, 'kind', 'removed', 'work_date', a.work_date, 'assignment_id', a.id),
        jsonb_build_object('user_id', v_new.user_id, 'kind', 'added', 'work_date', v_new.work_date, 'assignment_id', v_new.id));
    ELSIF (v_new.work_date, v_new.starts_at, v_new.ends_at, v_new.shift_id) IS DISTINCT FROM (a.work_date, a.starts_at, a.ends_at, a.shift_id) THEN
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'user_id', v_new.user_id, 'kind', 'changed', 'work_date', v_new.work_date, 'assignment_id', v_new.id));
    END IF;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'change_id', c.id, 'kind', 'update', 'assignment_id', v_new.id, 'version', v_new.version));
    INSERT INTO public.operational_audit_events (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_note, source)
    VALUES (p_tenant_id, 'shift_assignment', v_new.id, 'updated', p_actor, p_actor_role,
            jsonb_build_object('user_id', a.user_id, 'work_date', a.work_date, 'start_time', a.start_time, 'end_time', a.end_time, 'shift_id', a.shift_id),
            jsonb_build_object('user_id', v_new.user_id, 'work_date', v_new.work_date, 'start_time', v_new.start_time, 'end_time', v_new.end_time, 'shift_id', v_new.shift_id, 'revision_id', v_rev.id),
            c.reason, 'api');
  END LOOP;

  -- Phase 3: new shifts.
  FOR c IN
    SELECT * FROM public.schedule_revision_changes WHERE revision_id = v_rev.id AND kind = 'create' ORDER BY id
  LOOP
    INSERT INTO public.shift_assignments (
        tenant_id, user_id, shift_id, work_date, shift_name, department_id, start_time, end_time, starts_at, ends_at,
        snapshot_source, publication_state, version, notes, created_by, updated_by)
    VALUES (
        p_tenant_id, (c.proposed->>'user_id')::uuid, (c.proposed->>'shift_id')::uuid, (c.proposed->>'work_date')::date,
        c.proposed->>'shift_name', (c.proposed->>'department_id')::uuid, (c.proposed->>'start_time')::time,
        (c.proposed->>'end_time')::time, (c.proposed->>'starts_at')::timestamptz, (c.proposed->>'ends_at')::timestamptz,
        'occurrence', 'published', 1, c.proposed->>'notes', p_actor, p_actor)
    RETURNING * INTO v_new;
    v_created := v_created + 1;
    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'user_id', v_new.user_id, 'kind', 'added', 'work_date', v_new.work_date, 'assignment_id', v_new.id));
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'change_id', c.id, 'kind', 'create', 'assignment_id', v_new.id, 'version', v_new.version));
    INSERT INTO public.operational_audit_events (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_note, source)
    VALUES (p_tenant_id, 'shift_assignment', v_new.id, 'created', p_actor, p_actor_role, '{}'::jsonb,
            jsonb_build_object('user_id', v_new.user_id, 'work_date', v_new.work_date, 'start_time', v_new.start_time, 'end_time', v_new.end_time, 'revision_id', v_rev.id),
            c.reason, 'api');
  END LOOP;

  -- Notification intents: ONE per affected employee per revision (counts, no sensitive detail), same transaction.
  INSERT INTO public.schedule_notifications (tenant_id, user_id, event_type, dedupe_key, revision_id, payload)
  SELECT p_tenant_id, e.user_id, 'schedule_published', 'rev:' || v_rev.id::text || ':user:' || e.user_id::text, v_rev.id,
         jsonb_build_object(
           'revision_id', v_rev.id,
           'added', count(*) FILTER (WHERE e.kind = 'added'),
           'changed', count(*) FILTER (WHERE e.kind = 'changed'),
           'cancelled', count(*) FILTER (WHERE e.kind = 'cancelled'),
           'removed', count(*) FILTER (WHERE e.kind = 'removed'),
           'first_date', min(e.work_date),
           'assignment_id', CASE WHEN count(*) = 1 THEN max(e.assignment_id::text) END)
    FROM jsonb_to_recordset(v_events) AS e(user_id uuid, kind text, work_date date, assignment_id uuid)
   GROUP BY e.user_id
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_queued = ROW_COUNT;
  SELECT count(DISTINCT e.user_id) INTO v_people FROM jsonb_to_recordset(v_events) AS e(user_id uuid);

  v_result := jsonb_build_object(
    'publication_id', v_rev.id,
    'revision_id', v_rev.id,
    'published_at', now(),
    'created', v_created, 'updated', v_updated, 'cancelled', v_cancelled,
    'employees_affected', v_people,
    'notifications_queued', v_queued,
    'changes', v_outcomes,
    'replayed', false);

  UPDATE public.schedule_revisions SET
      status = 'published', published_at = now(), published_by = p_actor, publication_key = p_idempotency_key,
      result = v_result, version = version + 1, updated_by = p_actor, updated_at = now()
    WHERE id = v_rev.id;

  IF v_rev.corrects_revision_id IS NOT NULL THEN
    UPDATE public.schedule_revisions SET status = 'superseded', updated_at = now()
      WHERE id = v_rev.corrects_revision_id AND tenant_id = p_tenant_id AND status = 'published';
  END IF;

  INSERT INTO public.schedule_revision_events (tenant_id, revision_id, event, actor_id, detail)
  VALUES (p_tenant_id, v_rev.id, 'publication_succeeded', p_actor,
          jsonb_build_object('created', v_created, 'updated', v_updated, 'cancelled', v_cancelled, 'employees_affected', v_people));
  IF v_queued > 0 THEN
    INSERT INTO public.schedule_revision_events (tenant_id, revision_id, event, actor_id, detail)
    VALUES (p_tenant_id, v_rev.id, 'notification_queued', p_actor, jsonb_build_object('count', v_queued));
  END IF;
  IF v_rev.corrects_revision_id IS NOT NULL THEN
    INSERT INTO public.schedule_revision_events (tenant_id, revision_id, event, actor_id, detail)
    VALUES (p_tenant_id, v_rev.id, 'corrective_published', p_actor, jsonb_build_object('corrects', v_rev.corrects_revision_id));
  END IF;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Access: service-role writes only (the API enforces tenant, department and role); no policy = no direct client access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.schedule_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_revision_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_revision_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_notifications    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.publish_schedule_revision(uuid, uuid, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_schedule_revision(uuid, uuid, integer, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_schedule_notifications(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_notifications(integer, uuid) TO service_role;
