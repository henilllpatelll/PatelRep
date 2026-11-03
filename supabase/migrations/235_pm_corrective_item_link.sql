-- =============================================================================
-- Migration 235: Engineering PM + Assets V2 - durable link from a corrective work order to its failed checklist item (Phase 6)
-- =============================================================================
-- Additive only. Nothing historical is edited and no backfill is attempted.
--
--   1. work_orders.pm_completion_item_key: the pm_completion_items.item_key of the failed step this order was opened for.
--      NULL for every order created before this migration and for any order without a PM origin: nothing is inferred from a title.
--      Deliberately not a foreign key: pm_completion_items is append-only and keyed by (completion_id, item_key), and the
--      work order must never be blocked or cascaded by it. It is resolved by reading the completion's items.
--   2. record_pm_completion() is replaced with an identical body except that each corrective order now also stores the
--      item key it came from, inside the same transaction as the completion. Signature, return shape, locking, idempotency,
--      the (tenant, completion, title) uniqueness and the privileges are unchanged.
-- Rollback: redeploy migration 232's function body and drop the column; no data other than the key itself is lost.
-- =============================================================================

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS pm_completion_item_key TEXT;
COMMENT ON COLUMN public.work_orders.pm_completion_item_key IS 'pm_completion_items.item_key of the failed PM checklist step this corrective order was opened for. NULL = not recorded (older orders, or not PM-generated).';

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
      AS w(label text, item_key text, asset_id uuid, title text, description text, category text, priority text,
           created_by uuid, sla_minutes integer, due_at timestamptz)
  LOOP
    v_wo_id := NULL;
    INSERT INTO public.work_orders (
      tenant_id, asset_id, title, description, category, priority, created_by,
      is_pm_generated, pm_completion_id, pm_completion_item_key, sla_minutes, due_at
    ) VALUES (
      p_tenant_id, v_item.asset_id, v_item.title, v_item.description, v_item.category, v_item.priority,
      v_item.created_by, true, p_completion_id, NULLIF(v_item.item_key, ''), v_item.sla_minutes, v_item.due_at
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
