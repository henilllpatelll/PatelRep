-- =============================================================================
-- Migration 242: shared work-order assignment operation (work_order_assign_apply)
-- =============================================================================
-- Additive only: one new function. It is the SINGLE implementation of the work-order assignment rules, used by
--   * the human route  POST /v1/work-orders/{wo_id}/assign  (routers/work_orders.py, via RPC), and
--   * the Agent Harness H2 Tool Gateway (agent_tool_execute_work_order_assign, migration 243), inside the same
--     transaction as approval consumption and the idempotency ledger.
--
-- Rules (unchanged from the route it replaces; now enforced under a row lock instead of a check-then-write):
--   * the work order exists in p_tenant_id                                   -> 'not_found'
--   * its status is assignable (open, escalated, in_progress, on_hold)      -> 'closed'
--   * the target is an ACTIVE 'engineer' role holder in the same hotel       -> 'assignee_not_eligible'
--   * assigning to the current assignee is a quiet success (no audit row)    -> 'unchanged'
--   * the caller's view of the current assignee must still be true          -> 'stale'
--   * otherwise assigned_to changes, status never does, and ONE append-only operational_audit_events row is written
--     in the same transaction                                                -> 'assigned' | 'reassigned'
--
-- The caller passes the actor it has ALREADY authorized (the route: require_role chief_engineer/gm; the gateway: the
-- approving human, re-verified in the same transaction). SECURITY INVOKER, empty search_path, service role only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.work_order_assign_apply(
  p_tenant_id             uuid,
  p_work_order_id         uuid,
  p_assignee_user_id      uuid,
  p_expected_assigned_to  uuid,
  p_actor_id              uuid,
  p_actor_role            text,
  p_reason_note           text,
  p_reason_code           text,
  p_source                text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_wo       public.work_orders%ROWTYPE;
  v_previous uuid;
BEGIN
  IF p_source NOT IN ('web', 'mobile', 'api', 'automation') THEN
    RAISE EXCEPTION 'invalid audit source' USING ERRCODE = '22023';
  END IF;
  IF p_actor_role IS NULL OR char_length(p_actor_role) > 40 THEN
    RAISE EXCEPTION 'invalid actor role' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wo FROM public.work_orders
   WHERE id = p_work_order_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_wo.status NOT IN ('open', 'escalated', 'in_progress', 'on_hold') THEN
    RETURN jsonb_build_object('outcome', 'closed', 'status', v_wo.status);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE tenant_id = p_tenant_id AND user_id = p_assignee_user_id AND role = 'engineer' AND is_active
  ) THEN
    RETURN jsonb_build_object('outcome', 'assignee_not_eligible');
  END IF;

  v_previous := v_wo.assigned_to;
  IF v_previous IS NOT DISTINCT FROM p_assignee_user_id THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'work_order', jsonb_build_object(
      'id', v_wo.id, 'title', v_wo.title, 'status', v_wo.status, 'priority', v_wo.priority,
      'assigned_to', v_wo.assigned_to, 'work_order_number', v_wo.work_order_number));
  END IF;
  IF v_previous IS DISTINCT FROM p_expected_assigned_to THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;

  UPDATE public.work_orders SET assigned_to = p_assignee_user_id
   WHERE id = v_wo.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_wo;

  INSERT INTO public.operational_audit_events (
    tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, reason_code,
    reason_note, source)
  VALUES (
    p_tenant_id, 'work_order', v_wo.id,
    CASE WHEN v_previous IS NULL THEN 'work_order.assigned' ELSE 'work_order.reassigned' END,
    p_actor_id, p_actor_role,
    jsonb_build_object('assigned_to', v_previous), jsonb_build_object('assigned_to', p_assignee_user_id),
    p_reason_code, p_reason_note, p_source);

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_previous IS NULL THEN 'assigned' ELSE 'reassigned' END,
    'previous_assigned_to', v_previous,
    'work_order', jsonb_build_object(
      'id', v_wo.id, 'title', v_wo.title, 'status', v_wo.status, 'priority', v_wo.priority,
      'assigned_to', v_wo.assigned_to, 'work_order_number', v_wo.work_order_number));
END;
$function$;

COMMENT ON FUNCTION public.work_order_assign_apply(uuid, uuid, uuid, uuid, uuid, text, text, text, text) IS
  'The one implementation of work-order assignment rules (human route and Agent Harness Tool Gateway). Locks the order, validates, updates and audits in one transaction.';

REVOKE ALL ON FUNCTION public.work_order_assign_apply(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_assign_apply(uuid, uuid, uuid, uuid, uuid, text, text, text, text)
  TO service_role;
