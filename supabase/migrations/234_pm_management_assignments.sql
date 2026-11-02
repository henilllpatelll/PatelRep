-- =============================================================================
-- Migration 234: Engineering PM + Assets V2 - management assignments (Phase 5)
-- =============================================================================
-- Additive only. Nothing historical is edited and no existing column changes meaning.
--
--   1. pm_schedules.row_version: optimistic concurrency for every management write (assign, edit, reschedule).
--   2. pm_schedules.assigned_to / assigned_for_due_at / assigned_at / assigned_by: WHO should do the CURRENT inspection.
--      A schedule is one recurring row whose next_due_at moves forward on completion; there is no occurrence table.
--      The assignment therefore records the due date it was made for. Once the schedule advances, next_due_at no longer
--      equals assigned_for_due_at and the assignment reads as lapsed: it never silently carries to the next cycle and
--      never grants anything. assigned_to_role (existing) stays the standing responsibility; this is a person.
--   3. pm_schedule_assignment_events: append-only history of assign / reassign / unassign.
--   4. assign_pm_schedule(): ONE transaction that locks the schedule, checks the caller's version, checks the assignee is
--      an active engineer of this property, writes the change, the event and the audit row.
--
-- Compatibility: older API builds neither read nor write the new columns. Order: apply BEFORE deploying the API.
-- Recovery: every object is new or a nullable/defaulted column; leaving them in place is harmless.
-- =============================================================================

ALTER TABLE public.pm_schedules
  ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_for_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pm_schedules_assigned_to_idx
  ON public.pm_schedules (tenant_id, assigned_to, next_due_at) WHERE assigned_to IS NOT NULL AND is_active;

COMMENT ON COLUMN public.pm_schedules.assigned_for_due_at IS
  'The next_due_at this assignment was made for. When next_due_at differs the assignment has lapsed and is ignored.';

CREATE TABLE IF NOT EXISTS public.pm_schedule_assignment_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pm_schedule_id  UUID        NOT NULL REFERENCES public.pm_schedules(id) ON DELETE CASCADE,
  due_at          TIMESTAMPTZ NOT NULL,
  action          TEXT        NOT NULL CHECK (action IN ('assigned', 'reassigned', 'unassigned')),
  from_user_id    UUID,
  to_user_id      UUID,
  actor_id        UUID        NOT NULL,
  actor_role      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pm_schedule_assignment_events_schedule_idx
  ON public.pm_schedule_assignment_events (tenant_id, pm_schedule_id, created_at DESC);

ALTER TABLE public.pm_schedule_assignment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_schedule_assignment_events_select ON public.pm_schedule_assignment_events;
CREATE POLICY pm_schedule_assignment_events_select ON public.pm_schedule_assignment_events
  FOR SELECT TO authenticated
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

-- Append-only: no UPDATE / DELETE policy exists for authenticated users; writes go through assign_pm_schedule() as service_role.

-- Statuses: ok | no_change | not_found | conflict | schedule_inactive | assignee_ineligible
CREATE OR REPLACE FUNCTION public.assign_pm_schedule(
  p_tenant_id        uuid,
  p_schedule_id      uuid,
  p_actor_id         uuid,
  p_actor_role       text,
  p_assignee_id      uuid,     -- NULL = unassign
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_schedule  public.pm_schedules%ROWTYPE;
  v_current   uuid;
  v_action    text;
  v_updated   public.pm_schedules%ROWTYPE;
BEGIN
  SELECT * INTO v_schedule FROM public.pm_schedules
   WHERE id = p_schedule_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_schedule.row_version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('status', 'conflict', 'current_version', v_schedule.row_version, 'assigned_to', v_schedule.assigned_to);
  END IF;
  IF NOT v_schedule.is_active THEN
    RETURN jsonb_build_object('status', 'schedule_inactive');
  END IF;

  -- An assignment made for an earlier due date has lapsed: it is not "the current assignee".
  v_current := CASE WHEN v_schedule.assigned_for_due_at IS NOT DISTINCT FROM v_schedule.next_due_at
                    THEN v_schedule.assigned_to ELSE NULL END;

  IF p_assignee_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.user_profiles up
        JOIN public.user_roles ur ON ur.user_id = up.id AND ur.tenant_id = up.tenant_id
       WHERE up.id = p_assignee_id AND up.tenant_id = p_tenant_id AND up.is_active
         AND ur.is_active AND ur.role IN ('engineer', 'chief_engineer')
    ) THEN
      RETURN jsonb_build_object('status', 'assignee_ineligible');
    END IF;
  END IF;

  IF p_assignee_id IS NOT DISTINCT FROM v_current THEN
    RETURN jsonb_build_object('status', 'no_change', 'schedule', to_jsonb(v_schedule));
  END IF;

  v_action := CASE WHEN p_assignee_id IS NULL THEN 'unassigned'
                   WHEN v_current IS NULL THEN 'assigned' ELSE 'reassigned' END;

  UPDATE public.pm_schedules SET
    assigned_to = p_assignee_id,
    assigned_for_due_at = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE v_schedule.next_due_at END,
    assigned_at = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE now() END,
    assigned_by = CASE WHEN p_assignee_id IS NULL THEN NULL ELSE p_actor_id END,
    row_version = v_schedule.row_version + 1
  WHERE id = p_schedule_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_updated;

  INSERT INTO public.pm_schedule_assignment_events
    (tenant_id, pm_schedule_id, due_at, action, from_user_id, to_user_id, actor_id, actor_role)
  VALUES
    (p_tenant_id, p_schedule_id, v_schedule.next_due_at, v_action, v_current, p_assignee_id, p_actor_id, p_actor_role);

  INSERT INTO public.operational_audit_events (
    tenant_id, resource_type, resource_id, action, actor_id, actor_role, old_state, new_state, source
  ) VALUES (
    p_tenant_id, 'pm_schedule', p_schedule_id, 'pm_schedule.' || v_action, p_actor_id, p_actor_role,
    jsonb_build_object('assigned_to', v_current, 'due_at', v_schedule.next_due_at),
    jsonb_build_object('assigned_to', p_assignee_id, 'due_at', v_schedule.next_due_at),
    'api'
  );

  RETURN jsonb_build_object('status', 'ok', 'action', v_action, 'schedule', to_jsonb(v_updated));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_pm_schedule(uuid, uuid, uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_pm_schedule(uuid, uuid, uuid, text, uuid, integer) TO service_role;

-- =============================================================================
-- 5. Which due date a completion satisfied (for on-time reporting)
-- =============================================================================
-- Before this migration a completion did not record the deadline it met, and the schedule's next_due_at has since moved,
-- so on-time performance cannot be rebuilt for past rows. They keep due_at = NULL and are reported as "no recorded
-- deadline" rather than guessed. From now on the deadline is captured at insert, from the schedule as it stands under the
-- lock record_pm_completion() already holds (an approved deferral has already moved next_due_at, so this is the
-- EFFECTIVE deadline). A trigger, not an edit of record_pm_completion(), keeps the Phase 1 function untouched.
ALTER TABLE public.pm_completion_records ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.pm_completion_capture_due_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.due_at IS NULL THEN
    SELECT next_due_at INTO NEW.due_at FROM public.pm_schedules
     WHERE id = NEW.pm_schedule_id AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pm_completion_capture_due_at ON public.pm_completion_records;
CREATE TRIGGER pm_completion_capture_due_at BEFORE INSERT ON public.pm_completion_records
  FOR EACH ROW EXECUTE FUNCTION public.pm_completion_capture_due_at();

CREATE INDEX IF NOT EXISTS pm_completion_records_completed_idx
  ON public.pm_completion_records (tenant_id, completed_at DESC);
