-- =============================================================================
-- Migration 232: Engineering PM + Assets V2 foundation (Phase 1)
-- =============================================================================
-- Additive only. Nothing historical is edited, no data is removed, no existing column changes meaning.
--
--   1. pm_schedules -> checklist association (checklist_template_id + checklist_template_code).
--      Existing schedules keep both NULL = "unassigned": the mobile app keeps asking the technician to choose, and no
--      checklist is ever guessed for them. The code survives a deleted template so "template deleted" is distinguishable
--      from "never configured".
--   2. pm_completion_records.submission_id / submission_hash: a client-generated idempotency key, unique per tenant.
--   3. record_pm_completion(): ONE transaction that claims the submission, writes the completion, its items, the
--      corrective work orders, the evidence links and the audit rows, and advances the schedule. Replaying the same
--      accepted submission returns the original; the same key with a different payload is a conflict.
--   4. pm_deferral_decisions + decide_pm_deferral(): a deferral is a request (pm_deferrals row, still append-only) and a
--      decision is a separate append-only row made by the AUTHENTICATED reviewer. UNIQUE (deferral_id) is the database
--      guarantee that a request is decided, and applied to the schedule, at most once.
--   5. Unique active asset tag per property (created only when no duplicate already exists, so this can never fail a
--      deploy; the API enforces the same rule either way).
--
-- Compatibility: pm_deferrals rows written before this migration carry approved_by and were applied when created; they are
-- read as approved. Order: apply this migration BEFORE deploying the API that calls record_pm_completion().
-- Recovery: every object is new or an added nullable column; leaving them in place is harmless to older API builds
-- (older builds neither read nor write them).
-- =============================================================================

-- 1. Schedule -> checklist association ---------------------------------------
ALTER TABLE public.pm_schedules
  ADD COLUMN IF NOT EXISTS checklist_template_id UUID REFERENCES public.pm_checklist_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checklist_template_code TEXT;

CREATE INDEX IF NOT EXISTS pm_schedules_checklist_template_idx
  ON public.pm_schedules (checklist_template_id) WHERE checklist_template_id IS NOT NULL;

COMMENT ON COLUMN public.pm_schedules.checklist_template_id IS
  'The checklist procedure a technician follows for this schedule. NULL with a NULL code = never configured (legacy).';
COMMENT ON COLUMN public.pm_schedules.checklist_template_code IS
  'Identity of the assigned procedure. Kept when the template row is removed so the schedule reads as "template missing" rather than "unassigned".';

-- 2. Completion idempotency key ----------------------------------------------
ALTER TABLE public.pm_completion_records
  ADD COLUMN IF NOT EXISTS submission_id UUID,
  ADD COLUMN IF NOT EXISTS submission_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pm_completion_records_submission_uidx
  ON public.pm_completion_records (tenant_id, submission_id) WHERE submission_id IS NOT NULL;

-- One corrective work order per failed item of a completion, whatever the retry pattern. Created only when existing data
-- has no such duplicate, so it can never fail the deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.work_orders
    WHERE pm_completion_id IS NOT NULL
    GROUP BY tenant_id, pm_completion_id, title
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS work_orders_pm_completion_title_uidx
      ON public.work_orders (tenant_id, pm_completion_id, title)
      WHERE pm_completion_id IS NOT NULL AND is_pm_generated;
  ELSE
    RAISE NOTICE 'work_orders_pm_completion_title_uidx skipped: duplicate corrective work orders already exist';
  END IF;
END;
$$;

-- 3. Next-due arithmetic (mirrors services/pm_schedules.compute_next_due_at) ---
CREATE OR REPLACE FUNCTION public.pm_next_due_at(p_base timestamptz, p_interval_type text, p_interval_days integer)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT ((p_base AT TIME ZONE 'UTC') + (
    CASE p_interval_type
      WHEN 'custom'    THEN make_interval(days => COALESCE(NULLIF(p_interval_days, 0), 1))
      WHEN 'daily'     THEN interval '1 day'
      WHEN 'weekly'    THEN interval '1 week'
      WHEN 'monthly'   THEN interval '1 month'
      WHEN 'quarterly' THEN interval '3 months'
      WHEN 'annual'    THEN interval '1 year'
      ELSE interval '1 day'
    END
  )) AT TIME ZONE 'UTC';
$function$;

-- 4. Atomic, idempotent PM completion ----------------------------------------
-- Statuses: created | replayed | conflict | schedule_not_found | schedule_inactive | asset_inactive
CREATE OR REPLACE FUNCTION public.record_pm_completion(
  p_tenant_id       uuid,
  p_schedule_id     uuid,
  p_user_id         uuid,
  p_actor_role      text,
  p_completion_id   uuid,
  p_submission_id   uuid,
  p_submission_hash text,
  p_completion      jsonb,
  p_items           jsonb,
  p_corrective      jsonb,
  p_evidence_ids    uuid[],
  p_completed_at    timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_schedule    public.pm_schedules%ROWTYPE;
  v_existing    public.pm_completion_records%ROWTYPE;
  v_completion  public.pm_completion_records%ROWTYPE;
  v_asset_ok    boolean;
  v_base        timestamptz;
  v_next        timestamptz;
  v_wo_id       uuid;
  v_wos         jsonb := '[]'::jsonb;
  v_item        record;
BEGIN
  -- The schedule row lock serialises every completion of this schedule, including two identical submissions racing.
  SELECT * INTO v_schedule FROM public.pm_schedules
   WHERE id = p_schedule_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'schedule_not_found');
  END IF;

  -- Idempotency first, so a retry after the asset was retired still returns the original answer.
  IF p_submission_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.pm_completion_records
     WHERE tenant_id = p_tenant_id AND submission_id = p_submission_id;
    IF FOUND THEN
      IF v_existing.pm_schedule_id = p_schedule_id AND v_existing.submission_hash IS NOT DISTINCT FROM p_submission_hash THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'completion', to_jsonb(v_existing),
          'corrective_work_orders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title) ORDER BY w.created_at), '[]'::jsonb)
              FROM public.work_orders w
             WHERE w.tenant_id = p_tenant_id AND w.pm_completion_id = v_existing.id AND w.is_pm_generated
          )
        );
      END IF;
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
  END IF;

  IF NOT v_schedule.is_active THEN
    RETURN jsonb_build_object('status', 'schedule_inactive');
  END IF;
  SELECT is_active INTO v_asset_ok FROM public.assets WHERE id = v_schedule.asset_id AND tenant_id = p_tenant_id;
  IF v_asset_ok IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('status', 'asset_inactive');
  END IF;

  INSERT INTO public.pm_completion_records (
    id, tenant_id, pm_schedule_id, asset_id, checklist_template_id, checklist_version, technician_id, verifier_id,
    measurements, meter_readings, photos, labor_minutes, parts_used, defects, vendor_id, vendor_name,
    certificate_attachments, notes, completed_at, submission_id, submission_hash
  ) VALUES (
    p_completion_id, p_tenant_id, p_schedule_id, v_schedule.asset_id,
    NULLIF(p_completion->>'checklist_template_id', '')::uuid,
    NULLIF(p_completion->>'checklist_version', '')::integer,
    p_user_id,
    NULLIF(p_completion->>'verifier_id', '')::uuid,
    COALESCE(p_completion->'measurements', '{}'::jsonb),
    COALESCE(p_completion->'meter_readings', '{}'::jsonb),
    COALESCE(p_completion->'photos', '[]'::jsonb),
    COALESCE(NULLIF(p_completion->>'labor_minutes', '')::integer, 0),
    COALESCE(p_completion->'parts_used', '[]'::jsonb),
    COALESCE(p_completion->'defects', '[]'::jsonb),
    NULLIF(p_completion->>'vendor_id', '')::uuid,
    NULLIF(p_completion->>'vendor_name', ''),
    COALESCE(p_completion->'certificate_attachments', '[]'::jsonb),
    NULLIF(p_completion->>'notes', ''),
    p_completed_at, p_submission_id, p_submission_hash
  ) RETURNING * INTO v_completion;

  INSERT INTO public.pm_completion_items (tenant_id, completion_id, item_key, label, result, requires_evidence, evidence, note)
  SELECT p_tenant_id, p_completion_id, i.item_key, i.label, i.result,
         COALESCE(i.requires_evidence, false), COALESCE(i.evidence, '[]'::jsonb), i.note
    FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
         AS i(item_key text, label text, result text, requires_evidence boolean, evidence jsonb, note text);

  IF p_evidence_ids IS NOT NULL AND cardinality(p_evidence_ids) > 0 THEN
    UPDATE public.evidence_records
       SET related_entity_type = 'pm_completion', related_entity_id = p_completion_id
     WHERE tenant_id = p_tenant_id AND id = ANY (p_evidence_ids);
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_corrective, '[]'::jsonb))
      AS w(label text, asset_id uuid, title text, description text, category text, priority text,
           created_by uuid, sla_minutes integer, due_at timestamptz)
  LOOP
    v_wo_id := NULL;
    INSERT INTO public.work_orders (
      tenant_id, asset_id, title, description, category, priority, created_by,
      is_pm_generated, pm_completion_id, sla_minutes, due_at
    ) VALUES (
      p_tenant_id, v_item.asset_id, v_item.title, v_item.description, v_item.category, v_item.priority,
      v_item.created_by, true, p_completion_id, v_item.sla_minutes, v_item.due_at
    ) ON CONFLICT DO NOTHING
    RETURNING id INTO v_wo_id;
    IF v_wo_id IS NOT NULL THEN
      v_wos := v_wos || jsonb_build_array(jsonb_build_object('id', v_wo_id, 'title', v_item.title));
    END IF;
    INSERT INTO public.operational_audit_events (
      tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_code, source
    ) VALUES (
      p_tenant_id, 'pm_completion', p_completion_id, 'pm_check.failed_containment', p_user_id, p_actor_role,
      '{}'::jsonb, jsonb_build_object('item', v_item.label, 'work_order_id', v_wo_id), 'failed_check', 'api'
    );
  END LOOP;

  -- Advance exactly once for this accepted completion, from the schedule as it stands under the lock.
  v_base := CASE WHEN v_schedule.recurrence_basis = 'completion_date' THEN p_completed_at ELSE v_schedule.next_due_at END;
  v_next := public.pm_next_due_at(v_base, v_schedule.interval_type, v_schedule.interval_days);
  UPDATE public.pm_schedules
     SET last_completed_at = p_completed_at, next_due_at = v_next
   WHERE id = p_schedule_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'completion', to_jsonb(v_completion),
    'corrective_work_orders', v_wos,
    'next_due_at', v_next
  );
EXCEPTION WHEN unique_violation THEN
  -- A different schedule reused the key, or an index we do not model fired: nothing from this call is kept.
  RETURN jsonb_build_object('status', 'conflict');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_pm_completion(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pm_completion(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, uuid[], timestamptz)
  TO service_role;

-- 5. Deferral decisions -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pm_deferral_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  deferral_id UUID NOT NULL REFERENCES public.pm_deferrals(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_by_role TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  previous_due_at TIMESTAMPTZ,
  applied_due_at TIMESTAMPTZ,
  UNIQUE (deferral_id)
);

CREATE INDEX IF NOT EXISTS pm_deferral_decisions_tenant_idx
  ON public.pm_deferral_decisions (tenant_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS pm_deferral_decisions_decided_by_idx
  ON public.pm_deferral_decisions (decided_by);

ALTER TABLE public.pm_deferral_decisions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pm_deferral_decisions' AND policyname = 'tenant_pm_deferral_decisions') THEN
    CREATE POLICY "tenant_pm_deferral_decisions" ON public.pm_deferral_decisions
      FOR ALL USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pm_deferral_decisions_immutable' AND tgrelid = 'public.pm_deferral_decisions'::regclass) THEN
    CREATE TRIGGER pm_deferral_decisions_immutable
      BEFORE UPDATE OR DELETE ON public.pm_deferral_decisions
      FOR EACH ROW EXECUTE FUNCTION public.reject_operational_program_mutation();
  END IF;
  -- A requester can never be recorded as their own approver (rows written before this migration are not re-checked).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_deferrals_not_self_approved' AND conrelid = 'public.pm_deferrals'::regclass) THEN
    ALTER TABLE public.pm_deferrals
      ADD CONSTRAINT pm_deferrals_not_self_approved CHECK (approved_by IS NULL OR approved_by <> requested_by) NOT VALID;
  END IF;
END;
$$;

-- Statuses: ok | not_found | already_decided | self_review | schedule_inactive | stale | expired | invalid_decision
CREATE OR REPLACE FUNCTION public.decide_pm_deferral(
  p_tenant_id     uuid,
  p_deferral_id   uuid,
  p_reviewer_id   uuid,
  p_reviewer_role text,
  p_decision      text,
  p_note          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_def      public.pm_deferrals%ROWTYPE;
  v_sched    public.pm_schedules%ROWTYPE;
  v_decision public.pm_deferral_decisions%ROWTYPE;
  v_prev     timestamptz;
  v_applied  timestamptz;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('status', 'invalid_decision');
  END IF;

  SELECT * INTO v_def FROM public.pm_deferrals WHERE id = p_deferral_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Serialise every decision about this schedule; a second reviewer waits here and then sees the first decision.
  SELECT * INTO v_sched FROM public.pm_schedules
   WHERE id = v_def.pm_schedule_id AND tenant_id = p_tenant_id FOR UPDATE;

  SELECT * INTO v_decision FROM public.pm_deferral_decisions WHERE deferral_id = p_deferral_id;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_decided', 'decision', to_jsonb(v_decision));
  END IF;
  IF v_def.approved_by IS NOT NULL THEN
    -- Written before decisions existed: it was approved and applied when created.
    RETURN jsonb_build_object('status', 'already_decided', 'legacy', true);
  END IF;
  IF v_def.requested_by = p_reviewer_id THEN
    RETURN jsonb_build_object('status', 'self_review');
  END IF;

  v_prev := v_sched.next_due_at;
  v_applied := NULL;
  IF p_decision = 'approved' THEN
    IF NOT v_sched.is_active THEN
      RETURN jsonb_build_object('status', 'schedule_inactive');
    END IF;
    IF v_def.deferred_until <= now() THEN
      RETURN jsonb_build_object('status', 'expired');
    END IF;
    IF v_def.deferred_until <= v_sched.next_due_at THEN
      RETURN jsonb_build_object('status', 'stale');
    END IF;
    UPDATE public.pm_schedules SET next_due_at = v_def.deferred_until
     WHERE id = v_sched.id AND tenant_id = p_tenant_id;
    v_applied := v_def.deferred_until;
  END IF;

  INSERT INTO public.pm_deferral_decisions (
    tenant_id, deferral_id, decision, decided_by, decided_by_role, note, previous_due_at, applied_due_at
  ) VALUES (
    p_tenant_id, p_deferral_id, p_decision, p_reviewer_id, p_reviewer_role, p_note, v_prev, v_applied
  ) RETURNING * INTO v_decision;

  INSERT INTO public.operational_audit_events (
    tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_code, reason_note, source
  ) VALUES (
    p_tenant_id, 'pm_deferral', p_deferral_id, 'pm_deferral.' || p_decision, p_reviewer_id, p_reviewer_role,
    jsonb_build_object('next_due_at', v_prev, 'requested_by', v_def.requested_by),
    jsonb_build_object('decision', p_decision, 'next_due_at', COALESCE(v_applied, v_prev),
                       'deferred_until', v_def.deferred_until, 'pm_schedule_id', v_def.pm_schedule_id),
    'pm_deferral', p_note, 'api'
  );

  RETURN jsonb_build_object('status', 'ok', 'decision', to_jsonb(v_decision));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status', 'already_decided');
END;
$function$;

REVOKE ALL ON FUNCTION public.decide_pm_deferral(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_pm_deferral(uuid, uuid, uuid, text, text, text) TO service_role;

-- 6. Active asset tags are unique within a property --------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.assets
    WHERE is_active AND asset_tag IS NOT NULL AND btrim(asset_tag) <> ''
    GROUP BY tenant_id, lower(btrim(asset_tag))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS assets_tenant_active_tag_uidx
      ON public.assets (tenant_id, lower(btrim(asset_tag)))
      WHERE is_active AND asset_tag IS NOT NULL AND btrim(asset_tag) <> '';
  ELSE
    RAISE NOTICE 'assets_tenant_active_tag_uidx skipped: duplicate active asset tags already exist (the API still rejects new duplicates)';
  END IF;
END;
$$;
