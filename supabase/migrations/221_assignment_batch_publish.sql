-- =============================================================================
-- Migration 221: atomic, idempotent multi-room assignment publication
-- (Supervisor Assignments V2, Phase 5)
-- =============================================================================
-- POST /housekeeping/assignments writes conditional items one at a time and the room_status mirror afterwards,
-- outside any transaction, so a multi-room request can be saved partly. publish_assignment_batch() is the
-- all-or-nothing counterpart: ONE PostgreSQL function, so ONE transaction (PostgREST runs an RPC in a single
-- transaction). Every check happens before the first write, and any failure -- a failed check, a lost race, a
-- constraint -- raises, which rolls back every assignment row, every status mirror, every audit row and the
-- idempotency record together. Nothing is "undone" afterwards; nothing was ever committed.
--
-- WHAT IT DOES, IN ORDER
--   1. Argument + actor checks: the actor must be an active gm / housekeeping_supervisor of the tenant. The
--      tenant and actor come from the API's verified session, never from the client.
--   2. Idempotency: pg_advisory_xact_lock on (tenant, operation) serialises concurrent duplicates; an operation
--      already committed returns its stored result and writes nothing; the same operation id with a different
--      request (or by another person) is refused.
--   3. The operating date must be the hotel's own today: the room_status mirror is live state, so publishing a
--      dated plan for any other day would corrupt today's mirror.
--   4. Locks: every involved room_status row, then every involved dated room_assignments row, each in
--      room_id order (the same order for every caller, so two batches cannot deadlock each other). A cleaner
--      starting a room updates room_status and therefore waits on, or is seen by, this lock.
--   5. Validation of every change against the LOCKED rows (tenant ownership, stage, soft blocks, expected owner,
--      employee eligibility). All problems are collected; any problem aborts the whole batch.
--   6. Writes: assignment rows + status mirrors. Cleaning type, room status and other metadata are preserved.
--   7. One operational_audit_events row per change and one assignment_batch_operations row holding the result.
--
-- NOTIFICATIONS are deliberately NOT sent from here. The API sends them after the commit and only for a newly
-- committed operation (a replay never re-notifies). A push failure can never roll an assignment back.
--
-- Additive only: no existing table, column, policy, function or row is altered. The legacy endpoint is untouched.
-- migration-safety: destructive-reviewed
-- rollback-plan: DROP FUNCTION public.publish_assignment_batch(uuid, uuid, uuid, date, jsonb) and then DROP TABLE public.assignment_batch_operations (nothing else references either). The only DELETE in this file is inside the function body: it removes ONE dated room_assignments row when a supervisor's reviewed removal is applied, guarded by tenant, room, date and expected owner; it does not run when the migration is applied.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.assignment_batch_operations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operation_id        uuid        NOT NULL,
  requested_by        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_date     date        NOT NULL,
  request_fingerprint text        NOT NULL,
  change_count        integer     NOT NULL CHECK (change_count > 0),
  result              jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_batch_operations_operation_uniq UNIQUE (tenant_id, operation_id)
);

COMMENT ON TABLE public.assignment_batch_operations IS
  'One row per COMMITTED assignment batch publication (publish_assignment_batch). Written in the same transaction as the assignment changes, so a row exists if and only if the batch committed. Holds the idempotency key and the stored result.';
COMMENT ON COLUMN public.assignment_batch_operations.request_fingerprint IS
  'sha256 of the canonical (date + room-ordered changes) request, computed inside the function. A reused operation_id with a different fingerprint is refused.';

-- Server-only: the API (service role) reads and writes it. No client role gets any access.
ALTER TABLE public.assignment_batch_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.assignment_batch_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.assignment_batch_operations TO service_role;

CREATE OR REPLACE FUNCTION public.publish_assignment_batch(
  p_tenant_id    uuid,
  p_actor_id     uuid,
  p_operation_id uuid,
  p_date         date,
  p_changes      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  c_max_changes   CONSTANT integer := 150;
  c_assignable    CONSTANT text[]  := ARRAY['DIRTY', 'PICKUP', 'OCCUPIED'];
  v_actor_role    text;
  v_tz            text;
  v_today         date;
  v_fingerprint   text;
  v_existing      public.assignment_batch_operations%ROWTYPE;
  v_room_ids      uuid[];
  v_hk_ids        uuid[];
  v_valid_hk      uuid[];
  v_malformed     jsonb;
  v_conflicts     jsonb := '[]'::jsonb;
  v_plan          jsonb := '[]'::jsonb;
  v_rooms         jsonb := '[]'::jsonb;
  v_result        jsonb;
  v_item          jsonb;
  v_rows          integer;
  v_count         integer;
  v_blocks        jsonb;
  v_current       uuid;
  v_expected      uuid;
  r               record;
BEGIN
  -- 1. arguments and actor ---------------------------------------------------------------------------------
  IF p_tenant_id IS NULL OR p_actor_id IS NULL OR p_operation_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422', DETAIL = '{"reason":"missing_argument"}';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422', DETAIL = '{"reason":"changes_required"}';
  END IF;
  IF jsonb_array_length(p_changes) > c_max_changes THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422',
      DETAIL = jsonb_build_object('reason', 'too_many_changes', 'max', c_max_changes)::text;
  END IF;

  SELECT ur.role INTO v_actor_role
  FROM public.user_roles ur
  WHERE ur.user_id = p_actor_id
    AND ur.tenant_id = p_tenant_id
    AND ur.is_active
    AND ur.role IN ('gm', 'housekeeping_supervisor')
  ORDER BY (ur.role = 'gm') DESC
  LIMIT 1;
  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0403', DETAIL = '{"reason":"role"}';
  END IF;

  -- 2. shape of every change (uuid casts and required fields) ---------------------------------------------
  BEGIN
    SELECT coalesce(jsonb_agg(DISTINCT x.room_id), '[]'::jsonb) INTO v_malformed
    FROM jsonb_to_recordset(p_changes) AS x(room_id uuid, kind text, housekeeper_id uuid, expected_assigned_to uuid, expect_unassigned boolean)
    WHERE x.room_id IS NULL
       OR x.kind IS NULL OR x.kind NOT IN ('assign', 'reassign', 'remove')
       OR (x.kind = 'assign'   AND (x.housekeeper_id IS NULL OR x.expected_assigned_to IS NOT NULL OR x.expect_unassigned IS NOT TRUE))
       OR (x.kind = 'reassign' AND (x.housekeeper_id IS NULL OR x.expected_assigned_to IS NULL OR x.expect_unassigned IS TRUE
                                    OR x.housekeeper_id = x.expected_assigned_to))
       OR (x.kind = 'remove'   AND (x.housekeeper_id IS NOT NULL OR x.expected_assigned_to IS NULL OR x.expect_unassigned IS TRUE));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422', DETAIL = '{"reason":"malformed_changes"}';
  END;
  IF jsonb_array_length(v_malformed) > 0 OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_changes) AS x(room_id uuid) WHERE x.room_id IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422',
      DETAIL = jsonb_build_object('reason', 'malformed_changes', 'rooms', v_malformed)::text;
  END IF;

  -- One change per room: a room twice in one batch is a contradiction, never "last one wins".
  SELECT coalesce(jsonb_agg(d.room_id), '[]'::jsonb) INTO v_malformed
  FROM (
    SELECT x.room_id FROM jsonb_to_recordset(p_changes) AS x(room_id uuid) GROUP BY x.room_id HAVING count(*) > 1
  ) d;
  IF jsonb_array_length(v_malformed) > 0 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0422',
      DETAIL = jsonb_build_object('reason', 'duplicate_room', 'rooms', v_malformed)::text;
  END IF;

  SELECT array_agg(x.room_id ORDER BY x.room_id) INTO v_room_ids
  FROM jsonb_to_recordset(p_changes) AS x(room_id uuid);
  SELECT coalesce(array_agg(DISTINCT x.housekeeper_id), ARRAY[]::uuid[]) INTO v_hk_ids
  FROM jsonb_to_recordset(p_changes) AS x(housekeeper_id uuid)
  WHERE x.housekeeper_id IS NOT NULL;

  -- Canonical fingerprint: the date and the changes in room order, with nothing the caller could vary without
  -- changing what is published.
  SELECT encode(
           sha256(convert_to(
             jsonb_build_object(
               'date', p_date,
               'changes', (
                 SELECT jsonb_agg(jsonb_build_object(
                          'room_id', x.room_id,
                          'kind', x.kind,
                          'housekeeper_id', x.housekeeper_id,
                          'expected_assigned_to', x.expected_assigned_to
                        ) ORDER BY x.room_id)
                 FROM jsonb_to_recordset(p_changes) AS x(room_id uuid, kind text, housekeeper_id uuid, expected_assigned_to uuid)
               )
             )::text, 'UTF8')),
           'hex') INTO v_fingerprint;

  -- 3. idempotency -----------------------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_operation_id::text, 0));
  SELECT * INTO v_existing
  FROM public.assignment_batch_operations o
  WHERE o.tenant_id = p_tenant_id AND o.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.requested_by <> p_actor_id OR v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'operation_id_reused' USING ERRCODE = 'P0409', DETAIL = '{"reason":"different_request"}';
    END IF;
    RETURN v_existing.result || jsonb_build_object('replayed', true);
  END IF;

  -- 4. the operating date ----------------------------------------------------------------------------------
  SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0403', DETAIL = '{"reason":"tenant"}';
  END IF;
  v_today := (now() AT TIME ZONE coalesce(v_tz, 'UTC'))::date;
  IF p_date <> v_today THEN
    RAISE EXCEPTION 'date_mismatch' USING ERRCODE = 'P0409',
      DETAIL = jsonb_build_object('reason', 'not_hotel_today', 'expected_date', v_today)::text;
  END IF;

  -- 5. locks, deterministic order: room_status then dated room_assignments, both by room_id ----------------
  PERFORM 1 FROM public.room_status rs
  WHERE rs.tenant_id = p_tenant_id AND rs.room_id = ANY (v_room_ids)
  ORDER BY rs.room_id
  FOR UPDATE;
  PERFORM 1 FROM public.room_assignments ra
  WHERE ra.tenant_id = p_tenant_id AND ra.assignment_date = p_date AND ra.room_id = ANY (v_room_ids)
  ORDER BY ra.room_id
  FOR UPDATE;

  -- 6. validate every change against the locked rows -------------------------------------------------------
  SELECT coalesce(array_agg(DISTINCT ur.user_id), ARRAY[]::uuid[]) INTO v_valid_hk
  FROM public.user_roles ur
  WHERE ur.tenant_id = p_tenant_id AND ur.is_active
    AND ur.role IN ('housekeeper', 'housekeeping_supervisor')
    AND ur.user_id = ANY (v_hk_ids);

  FOR r IN
    SELECT x.room_id, x.kind, x.housekeeper_id, x.expected_assigned_to,
           rm.id AS known_room_id, rm.room_number,
           rs.status, rs.assigned_to AS mirror_owner, rs.clean_type,
           rs.dnd_flag, rs.do_not_service, rs.dnd_retry_at,
           ra.id AS dated_id, ra.assigned_to AS dated_owner
    FROM jsonb_to_recordset(p_changes) AS x(room_id uuid, kind text, housekeeper_id uuid, expected_assigned_to uuid)
    LEFT JOIN public.rooms rm ON rm.id = x.room_id AND rm.tenant_id = p_tenant_id
    LEFT JOIN public.room_status rs ON rs.room_id = x.room_id AND rs.tenant_id = p_tenant_id
    LEFT JOIN public.room_assignments ra
           ON ra.room_id = x.room_id AND ra.tenant_id = p_tenant_id AND ra.assignment_date = p_date
    ORDER BY x.room_id
  LOOP
    IF r.known_room_id IS NULL OR r.status IS NULL THEN
      v_conflicts := v_conflicts || jsonb_build_object('room_id', r.room_id, 'code', 'room_not_found');
      CONTINUE;
    END IF;
    IF NOT (r.status = ANY (c_assignable)) THEN
      v_conflicts := v_conflicts || jsonb_build_object('room_id', r.room_id, 'room_number', r.room_number, 'code', 'room_not_assignable');
      CONTINUE;
    END IF;

    -- The owner follows the board's rule: the dated row, else the status mirror.
    v_current  := CASE WHEN r.dated_id IS NOT NULL THEN r.dated_owner ELSE r.mirror_owner END;
    v_expected := r.expected_assigned_to;
    IF v_current IS DISTINCT FROM v_expected THEN
      v_conflicts := v_conflicts || jsonb_build_object('room_id', r.room_id, 'room_number', r.room_number,
                                                       'code', 'assignment_changed', 'current_assigned_to', v_current);
      CONTINUE;
    END IF;

    IF r.kind IN ('assign', 'reassign') THEN
      IF NOT (r.housekeeper_id = ANY (v_valid_hk)) THEN
        v_conflicts := v_conflicts || jsonb_build_object('room_id', r.room_id, 'room_number', r.room_number, 'code', 'invalid_housekeeper');
        CONTINUE;
      END IF;
      -- Soft blocks are a supervisor's decision per room; a bulk publication never carries an acknowledgement.
      v_blocks := '[]'::jsonb;
      IF r.do_not_service THEN v_blocks := v_blocks || '"service_declined"'::jsonb; END IF;
      IF r.dnd_flag THEN v_blocks := v_blocks || '"dnd"'::jsonb; END IF;
      IF r.dnd_retry_at IS NOT NULL AND r.dnd_retry_at > now() THEN v_blocks := v_blocks || '"return_later"'::jsonb; END IF;
      IF EXISTS (
        SELECT 1 FROM public.room_occupancy_discrepancies d
        WHERE d.tenant_id = p_tenant_id AND d.room_id = r.room_id AND d.status = 'open'
      ) THEN
        v_blocks := v_blocks || '"occupancy_discrepancy"'::jsonb;
      END IF;
      IF jsonb_array_length(v_blocks) > 0 THEN
        v_conflicts := v_conflicts || jsonb_build_object('room_id', r.room_id, 'room_number', r.room_number,
                                                         'code', 'room_blocked', 'blocks', v_blocks);
        CONTINUE;
      END IF;
    END IF;

    v_plan := v_plan || jsonb_build_object(
      'room_id', r.room_id, 'room_number', r.room_number, 'kind', r.kind, 'housekeeper_id', r.housekeeper_id,
      'previous_assigned_to', v_current, 'dated_id', r.dated_id, 'clean_type', r.clean_type);
  END LOOP;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    RAISE EXCEPTION 'assignment_batch_conflict' USING ERRCODE = 'P0409',
      DETAIL = jsonb_build_object('conflicts', v_conflicts)::text;
  END IF;

  -- 7. writes: assignment rows and status mirrors, in room order. Anything that does not behave raises. ----
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_plan) AS e(value) ORDER BY (e.value ->> 'room_id')::uuid LOOP
    IF v_item ->> 'kind' = 'remove' THEN
      IF v_item ->> 'dated_id' IS NOT NULL THEN
        DELETE FROM public.room_assignments ra
        WHERE ra.id = (v_item ->> 'dated_id')::uuid
          AND ra.tenant_id = p_tenant_id
          AND ra.room_id = (v_item ->> 'room_id')::uuid
          AND ra.assignment_date = p_date
          AND ra.assigned_to = (v_item ->> 'previous_assigned_to')::uuid;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'assignment_batch_conflict' USING ERRCODE = 'P0409',
            DETAIL = jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
              'room_id', v_item ->> 'room_id', 'code', 'assignment_changed')))::text;
        END IF;
      END IF;
      UPDATE public.room_status rs SET assigned_to = NULL
      WHERE rs.tenant_id = p_tenant_id AND rs.room_id = (v_item ->> 'room_id')::uuid AND rs.status = ANY (c_assignable);
    ELSE
      IF v_item ->> 'dated_id' IS NOT NULL THEN
        -- Reassign an existing dated row: new owner, new assigner, a hand-made (not AI) assignment with no stale
        -- walking order. clean_type, shift_id and every other column stay as they are.
        UPDATE public.room_assignments ra
        SET assigned_to = (v_item ->> 'housekeeper_id')::uuid,
            assigned_by = p_actor_id,
            is_ai_suggested = false,
            sequence_order = NULL
        WHERE ra.id = (v_item ->> 'dated_id')::uuid
          AND ra.tenant_id = p_tenant_id
          AND ra.room_id = (v_item ->> 'room_id')::uuid
          AND ra.assignment_date = p_date
          AND ra.assigned_to = (v_item ->> 'previous_assigned_to')::uuid;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'assignment_batch_conflict' USING ERRCODE = 'P0409',
            DETAIL = jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
              'room_id', v_item ->> 'room_id', 'code', 'assignment_changed')))::text;
        END IF;
      ELSE
        -- No dated row yet (an unassigned room, or a mirror-only assignment): create it. A plain INSERT, never an
        -- upsert, so a row that appeared in the meantime is a conflict and not an overwrite.
        BEGIN
          INSERT INTO public.room_assignments
            (tenant_id, room_id, assigned_to, assigned_by, shift_id, assignment_date, is_ai_suggested, clean_type, sequence_order)
          VALUES
            (p_tenant_id, (v_item ->> 'room_id')::uuid, (v_item ->> 'housekeeper_id')::uuid, p_actor_id, NULL, p_date, false,
             coalesce(v_item ->> 'clean_type', 'DEP'), NULL);
        EXCEPTION WHEN unique_violation THEN
          RAISE EXCEPTION 'assignment_batch_conflict' USING ERRCODE = 'P0409',
            DETAIL = jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
              'room_id', v_item ->> 'room_id', 'code', 'assignment_changed')))::text;
        END;
      END IF;
      UPDATE public.room_status rs SET assigned_to = (v_item ->> 'housekeeper_id')::uuid
      WHERE rs.tenant_id = p_tenant_id AND rs.room_id = (v_item ->> 'room_id')::uuid AND rs.status = ANY (c_assignable);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'assignment_batch_conflict' USING ERRCODE = 'P0409',
          DETAIL = jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
            'room_id', v_item ->> 'room_id', 'code', 'room_not_assignable')))::text;
      END IF;
    END IF;

    INSERT INTO public.operational_audit_events
      (tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, source)
    VALUES
      (p_tenant_id, 'room_assignment', (v_item ->> 'room_id')::uuid,
       'housekeeping.assignment.' || CASE v_item ->> 'kind' WHEN 'assign' THEN 'assigned' WHEN 'reassign' THEN 'reassigned' ELSE 'removed' END,
       p_actor_id, v_actor_role,
       jsonb_build_object('assigned_to', v_item -> 'previous_assigned_to', 'assignment_date', p_date),
       jsonb_build_object('assigned_to', v_item -> 'housekeeper_id', 'assignment_date', p_date, 'operation_id', p_operation_id),
       'api');

    v_rooms := v_rooms || jsonb_build_object(
      'room_id', v_item -> 'room_id', 'room_number', v_item -> 'room_number', 'kind', v_item -> 'kind',
      'previous_assigned_to', v_item -> 'previous_assigned_to', 'assigned_to', v_item -> 'housekeeper_id');
  END LOOP;

  -- 8. the result, stored atomically with the changes it describes ----------------------------------------
  v_count := jsonb_array_length(v_rooms);
  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'committed',
    'assignment_date', p_date,
    'counts', jsonb_build_object(
      'total', v_count,
      'assign',   (SELECT count(*) FROM jsonb_array_elements(v_rooms) e WHERE e.value ->> 'kind' = 'assign'),
      'reassign', (SELECT count(*) FROM jsonb_array_elements(v_rooms) e WHERE e.value ->> 'kind' = 'reassign'),
      'remove',   (SELECT count(*) FROM jsonb_array_elements(v_rooms) e WHERE e.value ->> 'kind' = 'remove')),
    'rooms', v_rooms,
    'affected_room_ids', (SELECT coalesce(jsonb_agg(e.value -> 'room_id'), '[]'::jsonb) FROM jsonb_array_elements(v_rooms) e),
    'affected_housekeeper_ids', (
      SELECT coalesce(jsonb_agg(DISTINCT u.id), '[]'::jsonb)
      FROM (
        SELECT (e.value ->> 'assigned_to') AS id FROM jsonb_array_elements(v_rooms) e WHERE e.value ->> 'assigned_to' IS NOT NULL
        UNION
        SELECT (e.value ->> 'previous_assigned_to') FROM jsonb_array_elements(v_rooms) e WHERE e.value ->> 'previous_assigned_to' IS NOT NULL
      ) u),
    'committed_at', now());

  INSERT INTO public.assignment_batch_operations
    (tenant_id, operation_id, requested_by, assignment_date, request_fingerprint, change_count, result)
  VALUES
    (p_tenant_id, p_operation_id, p_actor_id, p_date, v_fingerprint, v_count, v_result);

  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.publish_assignment_batch(uuid, uuid, uuid, date, jsonb) IS
  'All-or-nothing publication of a supervisor assignment draft (assign / reassign / remove, up to 150 rooms). One transaction: validates against row-locked state, applies assignment rows and room_status mirrors, writes audit rows and the idempotency record, or raises and commits nothing. Raises SQLSTATE P0409 (conflict), P0422 (invalid request) or P0403 (not authorised) with a machine-readable DETAIL. Idempotent per (tenant, operation_id).';

-- Only the API (service role) may publish: it supplies the verified tenant and acting user.
REVOKE ALL ON FUNCTION public.publish_assignment_batch(uuid, uuid, uuid, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_assignment_batch(uuid, uuid, uuid, date, jsonb) TO service_role;
