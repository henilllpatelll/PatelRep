-- =============================================================================
-- Migration 229: request-workflow notification intents written in the SAME transaction as the business change
-- (Team Scheduling & Shift Coverage V2, Phase 8)
-- =============================================================================
-- Until now, time-off, swap, offer and claim notifications were queued by the API AFTER its own write committed
-- (services/schedule_outbox.enqueue). A crash between the committed change and that second call lost the message: the
-- employee's request was decided and nobody was told. Only publication (migration 228) used a true transactional outbox.
--
-- These AFTER triggers write the schedule_notifications row inside the transaction that changes the request, so:
--   * a rolled-back change leaves no message (no false notification);
--   * a committed change always keeps its message, even if the process dies the next instant;
--   * the dedupe key is the one the API always used (`<event>:<id>:<user>`), so a replay or a duplicate trigger fire is
--     a no-op (ON CONFLICT DO NOTHING on the existing unique (tenant_id, dedupe_key));
--   * approve_shift_swap() and fill_coverage_gap() already run as one transaction, so their messages commit atomically
--     with the exchange / the fill.
-- Delivery stays a separate, retryable step (claim_schedule_notifications / services.schedule_outbox.process_batch); a
-- delivery failure never reaches back into these tables.
--
-- PRIVACY: payloads carry ids and a date only. Reasons, notes and decision text are never read here.
-- Recipients mirror the API exactly: people who act on a request are never told about their own action, and "managers" are
-- active gm / housekeeping_supervisor / engineer holders whose scope covers the department (gm covers all).
-- ALSO in this migration: claim_schedule_notifications() no longer re-claims a crashed delivery forever. Migration 228 reclaimed any
-- 'processing' row whose 2-minute lock expired, with no attempt bound, so a delivery that kept killing the worker (attempts only
-- ever grow) would loop and stay "processing" -- and revision_status() would report the publication as still processing for ever.
-- A row whose lock expired after its 5th attempt is now closed as failed ('abandoned_after_crash') and can be reset by a manager
-- like any other failed row.
-- ALSO in this migration (crash consistency of the coverage workflow, final audit): two operations the API used to perform as
-- separate writes with a compensating undo are now single transactions.
--   record_absence_with_gap()  the absence and its coverage gap. A crash between the two writes left a call-out with no gap,
--                              invisible to every coverage screen and un-retryable (the retry found the orphan and returned it).
--   create_coverage_offer()    the offer and the gap's open -> offered move, with the gap locked and its version checked. A lost
--                              race used to leave a live offer that was then "withdrawn", which also sent the employee two messages.
-- Error codes: CV001 gap changed since read, CV002 gap closed, CV003 not found; unique violations (23505) propagate unchanged.
-- NOT covered on purpose: `schedule_open_shift` (who may take an open shift is computed from availability, leave and
-- conflicts in the API; it stays a best-effort announcement and the Open Shifts screen is the source of truth).
--
-- migration-safety: additive only (new functions and triggers, no table or column changes, nothing dropped)
-- rollback-plan: restore migration 228's claim_schedule_notifications() body, remove public.record_absence_with_gap(uuid, jsonb, jsonb) and public.create_coverage_offer(uuid, uuid, integer, uuid, uuid, timestamptz), remove the four triggers (trg_notify_time_off, trg_notify_swap, trg_notify_offer, trg_notify_claim) and their functions, then public.schedule_notice, public.schedule_user_department and public.schedule_department_managers. Messages already written are ordinary schedule_notifications rows and stay valid.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.schedule_notice(
  p_tenant  uuid,
  p_user    uuid,
  p_event   text,
  p_key     text,
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.schedule_notifications (tenant_id, user_id, event_type, dedupe_key, payload)
  VALUES (p_tenant, p_user, p_event, p_event || ':' || p_key || ':' || p_user::text, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
END;
$function$;

-- The department a person works in: their explicit user_roles.department_id, else the default for their role.
-- NULL when neither exists (callers then notify nobody rather than guess).
CREATE OR REPLACE FUNCTION public.schedule_user_department(p_tenant uuid, p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(
    (SELECT ur.department_id FROM public.user_roles ur
      WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.is_active AND ur.department_id IS NOT NULL
      ORDER BY ur.department_id LIMIT 1),
    (SELECT d.id FROM public.user_roles ur
       JOIN public.departments d ON d.tenant_id = ur.tenant_id AND d.code = CASE ur.role
              WHEN 'housekeeper' THEN 'HK' WHEN 'housekeeping_supervisor' THEN 'HK'
              WHEN 'engineer' THEN 'ENG' WHEN 'chief_engineer' THEN 'ENG' WHEN 'front_desk' THEN 'FD' END
      WHERE ur.tenant_id = p_tenant AND ur.user_id = p_user AND ur.is_active
      ORDER BY d.id LIMIT 1)
  );
$function$;

-- Active schedule managers whose scope covers a department (same scope table as services/scheduling_contracts).
CREATE OR REPLACE FUNCTION public.schedule_department_managers(p_tenant uuid, p_department uuid, p_exclude uuid[] DEFAULT '{}')
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
   WHERE ur.tenant_id = p_tenant
     AND ur.is_active
     AND ur.role IN ('gm', 'housekeeping_supervisor', 'engineer')
     AND NOT (ur.user_id = ANY(COALESCE(p_exclude, '{}')))
     AND (ur.role = 'gm'
          OR (p_department IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.departments d
                 WHERE d.id = p_department AND d.tenant_id = p_tenant
                   AND d.code = CASE ur.role WHEN 'housekeeping_supervisor' THEN 'HK' ELSE 'ENG' END)));
$function$;

-- ---------------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_time_off() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_manager uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      FOR v_manager IN
        SELECT public.schedule_department_managers(
          NEW.tenant_id, COALESCE(NEW.department_id, public.schedule_user_department(NEW.tenant_id, NEW.user_id)), ARRAY[NEW.user_id])
      LOOP
        PERFORM public.schedule_notice(NEW.tenant_id, v_manager, 'schedule_time_off_requested', NEW.id::text,
                                       jsonb_build_object('request_id', NEW.id));
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'denied') AND NEW.decided_by IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.user_id,
                                   CASE NEW.status WHEN 'approved' THEN 'schedule_time_off_approved' ELSE 'schedule_time_off_denied' END,
                                   NEW.id::text, jsonb_build_object('request_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_time_off ON public.time_off_requests;
CREATE TRIGGER trg_notify_time_off
  AFTER INSERT OR UPDATE OF status ON public.time_off_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_time_off();

-- ---------------------------------------------------------------------------
-- Shift swaps
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_swap() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_manager   uuid;
  v_req_date  date;
  v_cnt_date  date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'proposed' THEN
      PERFORM public.schedule_notice(NEW.tenant_id, NEW.counterpart_id, 'schedule_swap_proposed', NEW.id::text,
                                     jsonb_build_object('swap_id', NEW.id));
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'proposed' AND NEW.status = 'accepted' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.requester_id, 'schedule_swap_accepted', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id));
    FOR v_manager IN
      SELECT public.schedule_department_managers(
        NEW.tenant_id, COALESCE(NEW.department_id, public.schedule_user_department(NEW.tenant_id, NEW.requester_id)),
        ARRAY[NEW.requester_id, NEW.counterpart_id])
    LOOP
      PERFORM public.schedule_notice(NEW.tenant_id, v_manager, 'schedule_swap_needs_approval', NEW.id::text,
                                     jsonb_build_object('swap_id', NEW.id));
    END LOOP;
  ELSIF OLD.status = 'proposed' AND NEW.status = 'declined' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.requester_id, 'schedule_swap_declined', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id));
  ELSIF OLD.status = 'accepted' AND NEW.status = 'approved' THEN
    -- Each person is sent to the day of the shift they now work (the other person's original date).
    SELECT work_date INTO v_req_date FROM public.shift_assignments WHERE id = NEW.requester_assignment_id;
    SELECT work_date INTO v_cnt_date FROM public.shift_assignments WHERE id = NEW.counterpart_assignment_id;
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.requester_id, 'schedule_swap_approved', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id, 'work_date', v_cnt_date));
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.counterpart_id, 'schedule_swap_approved', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id, 'work_date', v_req_date));
  ELSIF OLD.status = 'accepted' AND NEW.status = 'denied' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.requester_id, 'schedule_swap_denied', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id));
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.counterpart_id, 'schedule_swap_denied', NEW.id::text,
                                   jsonb_build_object('swap_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_swap ON public.shift_swap_requests;
CREATE TRIGGER trg_notify_swap
  AFTER INSERT OR UPDATE OF status ON public.shift_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_swap();

-- ---------------------------------------------------------------------------
-- Coverage offers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_offer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_date date;
BEGIN
  SELECT work_date INTO v_date FROM public.coverage_gaps WHERE id = NEW.gap_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      PERFORM public.schedule_notice(NEW.tenant_id, NEW.user_id, 'schedule_offer_received', NEW.id::text,
                                     jsonb_build_object('offer_id', NEW.id, 'gap_id', NEW.gap_id, 'work_date', v_date));
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'withdrawn' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.user_id, 'schedule_offer_withdrawn', NEW.id::text,
                                   jsonb_build_object('offer_id', NEW.id, 'gap_id', NEW.gap_id));
  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' AND NEW.offered_by IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.offered_by, 'schedule_offer_declined', NEW.id::text,
                                   jsonb_build_object('offer_id', NEW.id, 'gap_id', NEW.gap_id));
  ELSIF OLD.status = 'pending' AND NEW.status = 'accepted' AND NEW.offered_by IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.offered_by, 'schedule_offer_accepted', NEW.id::text,
                                   jsonb_build_object('offer_id', NEW.id, 'gap_id', NEW.gap_id));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_offer ON public.coverage_offers;
CREATE TRIGGER trg_notify_offer
  AFTER INSERT OR UPDATE OF status ON public.coverage_offers
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_offer();

-- ---------------------------------------------------------------------------
-- Open-shift claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_claim() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_manager uuid;
  v_gap     public.coverage_gaps%ROWTYPE;
BEGIN
  SELECT * INTO v_gap FROM public.coverage_gaps WHERE id = NEW.gap_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      FOR v_manager IN SELECT public.schedule_department_managers(NEW.tenant_id, v_gap.department_id, ARRAY[NEW.user_id]) LOOP
        PERFORM public.schedule_notice(NEW.tenant_id, v_manager, 'schedule_claim_submitted', NEW.id::text,
                                       jsonb_build_object('claim_id', NEW.id, 'gap_id', NEW.gap_id));
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.user_id, 'schedule_claim_approved', NEW.id::text,
                                   jsonb_build_object('claim_id', NEW.id, 'gap_id', NEW.gap_id, 'work_date', v_gap.work_date));
  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    PERFORM public.schedule_notice(NEW.tenant_id, NEW.user_id, 'schedule_claim_declined', NEW.id::text,
                                   jsonb_build_object('claim_id', NEW.id, 'gap_id', NEW.gap_id));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_claim ON public.coverage_claims;
CREATE TRIGGER trg_notify_claim
  AFTER INSERT OR UPDATE OF status ON public.coverage_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_claim();

-- Helpers are internal: only the triggers (and service_role tooling) call them.
REVOKE ALL ON FUNCTION public.schedule_notice(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_user_department(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_department_managers(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_time_off() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_swap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_offer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_notify_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_notice(uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_user_department(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_department_managers(uuid, uuid, uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Outbox claim: bounded reclaim of a crashed delivery (replaces migration 228's body; same signature and grants)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_schedule_notifications(p_limit integer, p_revision_id uuid DEFAULT NULL)
RETURNS SETOF public.schedule_notifications
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.schedule_notifications n
     SET status = 'failed', locked_until = NULL, last_error = 'abandoned_after_crash', processed_at = now()
   WHERE n.status = 'processing' AND n.locked_until < now() AND n.attempts >= 5
     AND (p_revision_id IS NULL OR n.revision_id = p_revision_id);

  RETURN QUERY
  WITH due AS (
    SELECT n.id FROM public.schedule_notifications n
     WHERE (n.status IN ('queued', 'failed') AND n.next_attempt_at <= now() AND n.attempts < 5
            OR n.status = 'processing' AND n.locked_until < now() AND n.attempts < 5)
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
-- Atomic call-out: the absence and its gap commit together or not at all
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_absence_with_gap(p_tenant_id uuid, p_absence jsonb, p_gap jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_abs public.absence_records%ROWTYPE;
  v_gap public.coverage_gaps%ROWTYPE;
BEGIN
  INSERT INTO public.absence_records (
    tenant_id, user_id, assignment_id, department_id, work_date, starts_at, ends_at, kind, status,
    leaving_at, note, recorded_by, confirmed_by, confirmed_at, idempotency_key
  ) VALUES (
    p_tenant_id, (p_absence->>'user_id')::uuid, (p_absence->>'assignment_id')::uuid, NULLIF(p_absence->>'department_id', '')::uuid,
    (p_absence->>'work_date')::date, (p_absence->>'starts_at')::timestamptz, (p_absence->>'ends_at')::timestamptz,
    p_absence->>'kind', COALESCE(p_absence->>'status', 'confirmed'), NULLIF(p_absence->>'leaving_at', '')::timestamptz,
    p_absence->>'note', NULLIF(p_absence->>'recorded_by', '')::uuid, NULLIF(p_absence->>'confirmed_by', '')::uuid,
    NULLIF(p_absence->>'confirmed_at', '')::timestamptz, NULLIF(p_absence->>'idempotency_key', '')
  ) RETURNING * INTO v_abs;

  INSERT INTO public.coverage_gaps (
    tenant_id, department_id, source, absence_id, original_assignment_id, shift_id, shift_name, work_date,
    start_time, end_time, starts_at, ends_at, required_role, status, claimable, created_by
  ) VALUES (
    p_tenant_id, (p_gap->>'department_id')::uuid, 'absence', v_abs.id, v_abs.assignment_id, (p_gap->>'shift_id')::uuid,
    COALESCE(p_gap->>'shift_name', ''), (p_gap->>'work_date')::date, (p_gap->>'start_time')::time, (p_gap->>'end_time')::time,
    (p_gap->>'starts_at')::timestamptz, (p_gap->>'ends_at')::timestamptz, NULLIF(p_gap->>'required_role', ''), 'open', false,
    NULLIF(p_gap->>'created_by', '')::uuid
  ) RETURNING * INTO v_gap;

  RETURN jsonb_build_object('absence', to_jsonb(v_abs), 'gap', to_jsonb(v_gap));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Atomic offer: the offer and the gap's open -> offered move commit together, against a locked, version-checked gap
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_coverage_offer(
  p_tenant_id        uuid,
  p_gap_id           uuid,
  p_expected_version integer,
  p_user_id          uuid,
  p_offered_by       uuid,
  p_expires_at       timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_gap   public.coverage_gaps%ROWTYPE;
  v_offer public.coverage_offers%ROWTYPE;
BEGIN
  SELECT * INTO v_gap FROM public.coverage_gaps WHERE id = p_gap_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coverage gap not found' USING ERRCODE = 'CV003';
  END IF;
  IF v_gap.status NOT IN ('open', 'offered') THEN
    RAISE EXCEPTION 'coverage gap is already %', v_gap.status USING ERRCODE = 'CV002';
  END IF;
  IF v_gap.version <> p_expected_version THEN
    RAISE EXCEPTION 'coverage gap changed' USING ERRCODE = 'CV001';
  END IF;

  INSERT INTO public.coverage_offers (tenant_id, gap_id, user_id, status, expires_at, offered_by, delivery, version)
  VALUES (p_tenant_id, p_gap_id, p_user_id, 'pending', p_expires_at, p_offered_by, 'not_sent', 1)
  RETURNING * INTO v_offer;

  IF v_gap.status = 'open' THEN
    UPDATE public.coverage_gaps SET status = 'offered', version = version + 1, updated_at = now() WHERE id = p_gap_id;
  END IF;

  RETURN to_jsonb(v_offer);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_absence_with_gap(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_coverage_offer(uuid, uuid, integer, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_absence_with_gap(uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_coverage_offer(uuid, uuid, integer, uuid, uuid, timestamptz) TO service_role;
