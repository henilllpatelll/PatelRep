-- =============================================================================
-- Migration 260: UPDATE integrity of agent safety controls, grants and approvals (H6 follow-up to 259)
-- =============================================================================
-- migration-safety: trigger + function only (one CREATE OR REPLACE of the existing SECURITY DEFINER journal trigger
--   function with the same signature, owner, search_path and ACL; one new SECURITY INVOKER trigger function; 4 BEFORE
--   UPDATE row triggers). Nothing removed, renamed or rewritten; no row changes; no privilege changes.
-- rollback-plan: forward-only. Allowing a retarget again needs a new reviewed migration.
--
-- Why (2026-11-19 audit of every H1-H6 table service_role can UPDATE):
--   * Identity retarget, unjournaled. The 256 journal compares only the state columns, so an UPDATE that moves a row
--     to another target while keeping its state wrote nothing: an active hotel / agent pause could be moved to another
--     hotel or agent (the original target silently unpaused), a tool pause to another tool, and a grant to another
--     hotel, agent version, tool or tool version (a silent grant for a tool nobody granted).
--   * Security-relevant columns outside the journal comparison: agent_runtime_controls.updated_by decides the operator
--     pause lock in agent_control_center_hotel_pause_set (an operator pause is lifted only by an operator), so relabeling
--     an operator pause as 'user:...' let a GM lift it, with no record. agent_tool_grants.max_risk (the admission risk
--     ceiling in agent__tool_grant_level), granted_by_user_id and revoked_by_user_id likewise changed unjournaled.
--   * agent_tool_approvals: 241 freezes the binding and 254 enforces independence, but a direct UPDATE could still
--     decide a pending approval in the name of anyone (a non-member, a deactivated user, a role without authority)
--     with any decided_role; only the execution-time re-check caught it, after the run had resumed.
--   Already protected and unchanged: agent_execution_enablement, agent_model_enablement and
--   agent_customer_billing_controls (singletons, id fixed by CHECK (id = 1); every decision column journaled),
--   agent_worker_credentials (255 guard: only one final revocation, journaled), agent_runs (238 identity guard),
--   budget / pricing / hold / charge / operation tables (244/248/250 guards).
-- What changes:
--   * agent__guard_control_update(): BEFORE UPDATE row guard on agent_runtime_controls, agent_tool_controls,
--     agent_tool_grants and agent_tool_approvals, for every role including the owner. Identity columns are immutable
--     (no legitimate path changes them: every setter is an upsert on the identity key). On an approval it requires a
--     decision (requested -> approved / rejected) to name a decider who CURRENTLY holds one of the approval's roles,
--     with decided_role equal to that role -- the same agent__human_authority() check agent_tool_approval_decide runs
--     in the same transaction, so the RPC is unaffected. No session variable, journal row or trigger depth is consulted.
--   * agent__journal_control_change() (256) additionally journals a change of agent_runtime_controls.updated_by and of
--     agent_tool_grants.max_risk / granted_by_user_id / revoked_by_user_id, adding the previous value to the detail.
--     Every other branch, the actor, subject and event types are unchanged; no new SECURITY DEFINER function.
--   * Fails closed if the guard function or any agent_control_update_guard trigger already exists.
-- Not changed: established control semantics (pause / unpause / grant / revoke / decide behave exactly as before);
--   descriptive columns (reason_code, updated_at) stay outside the journal comparison; no decision reads them.
-- Coordination: #239 (worker tenant binding) follows as 261.
-- =============================================================================

-- Fail closed if any migration-260 object already exists before this migration ran.
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
              WHERE pronamespace = 'public'::pg_catalog.regnamespace AND proname = 'agent__guard_control_update')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_control_update_guard') THEN
    RAISE EXCEPTION 'migration 260 objects (agent__guard_control_update / agent_control_update_guard) already exist; refusing to adopt them'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                  WHERE oid = 'public.agent__journal_control_change()'::pg_catalog.regprocedure AND prosecdef
                    AND proowner = 'postgres'::pg_catalog.regrole AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'migration 260 expects the reviewed 256 journal trigger function' USING ERRCODE = '42501';
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- (1) Row guard
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.agent__guard_control_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_role text;
BEGIN
  IF TG_OP <> 'UPDATE' OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'agent__guard_control_update runs only as a BEFORE UPDATE row trigger' USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'agent_runtime_controls' THEN
    IF (NEW.id, NEW.scope, NEW.tenant_id, NEW.agent_id) IS DISTINCT FROM (OLD.id, OLD.scope, OLD.tenant_id, OLD.agent_id) THEN
      RAISE EXCEPTION 'runtime control identity is immutable; set the target''s own control instead' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_tool_controls' THEN
    IF NEW.tool_id IS DISTINCT FROM OLD.tool_id THEN
      RAISE EXCEPTION 'tool control identity is immutable; set the target''s own control instead' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_tool_grants' THEN
    IF (NEW.id, NEW.tenant_id, NEW.agent_id, NEW.agent_version, NEW.tool_id, NEW.tool_version)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.agent_id, OLD.agent_version, OLD.tool_id, OLD.tool_version) THEN
      RAISE EXCEPTION 'tool grant identity is immutable; grant the target through agent_tool_grant_set' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_tool_approvals' THEN
    IF NEW.state IN ('approved', 'rejected') AND NEW.state IS DISTINCT FROM OLD.state THEN
      v_role := public.agent__human_authority(NEW.tenant_id, NEW.decided_by_user_id, NEW.required_approver_roles);
      IF v_role IS NULL OR NEW.decided_role IS DISTINCT FROM v_role THEN
        RAISE EXCEPTION 'an approval is decided only by a current member holding one of its approver roles'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'agent__guard_control_update is not reviewed for table %', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent__guard_control_update() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
COMMENT ON FUNCTION public.agent__guard_control_update() IS
  'Migration 260: identity of runtime / tool controls and tool grants is immutable for every role; an approval decision needs the decider''s current authority (agent__human_authority) and matching decided_role.';

DO $trg$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['agent_runtime_controls', 'agent_tool_controls', 'agent_tool_grants',
                                 'agent_tool_approvals'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER agent_control_update_guard BEFORE UPDATE ON public.%I '
                              'FOR EACH ROW EXECUTE FUNCTION public.agent__guard_control_update()', v_table);
  END LOOP;
END;
$trg$;

-- -----------------------------------------------------------------------------
-- (2) Journal: also record the security-relevant columns the 256 comparison skipped
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__journal_control_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  IF TG_TABLE_NAME = 'agent_runtime_controls' THEN
    -- 260: updated_by decides the operator pause lock, so a change of it alone is journaled too.
    IF v_old IS NOT NULL AND (v_old->'paused', v_old->'cost_emergency_stop', v_old->'updated_by')
                           = (v_new->'paused', v_new->'cost_emergency_stop', v_new->'updated_by') THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal((v_new->>'tenant_id')::uuid, 'runtime_control_changed',
      v_new->>'updated_by', 'runtime_control', v_new->>'scope' || COALESCE(':' || (v_new->>'agent_id'), ''),
      v_new->>'reason_code',
      jsonb_build_object('scope', v_new->'scope', 'agent_id', v_new->'agent_id',
                         'paused_before', v_old->'paused', 'paused', v_new->'paused',
                         'cost_emergency_stop_before', v_old->'cost_emergency_stop',
                         'cost_emergency_stop', v_new->'cost_emergency_stop')
      || CASE WHEN v_old IS NOT NULL AND v_old->'updated_by' IS DISTINCT FROM v_new->'updated_by'
              THEN jsonb_build_object('updated_by_before', v_old->'updated_by') ELSE '{}'::jsonb END);
  ELSIF TG_TABLE_NAME = 'agent_tool_grants' THEN
    -- 260: max_risk (the admission risk ceiling) and the granting / revoking user are journaled too.
    IF v_old IS NOT NULL AND (v_old->'max_level', v_old->'revoked_at', v_old->'expires_at', v_old->'granted_at',
                              v_old->'max_risk', v_old->'granted_by_user_id', v_old->'revoked_by_user_id')
                           = (v_new->'max_level', v_new->'revoked_at', v_new->'expires_at', v_new->'granted_at',
                              v_new->'max_risk', v_new->'granted_by_user_id', v_new->'revoked_by_user_id') THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal((v_new->>'tenant_id')::uuid, 'tool_grant_changed',
      'user:' || COALESCE(CASE WHEN v_new->>'revoked_at' IS NOT NULL THEN v_new->>'revoked_by_user_id' END,
                          v_new->>'granted_by_user_id'),
      'tool_grant', (v_new->>'tool_id') || '@' || (v_new->>'tool_version'),
      CASE WHEN v_new->>'revoked_at' IS NOT NULL THEN 'grant_revoked' ELSE 'grant_set' END,
      jsonb_build_object('agent_id', v_new->'agent_id', 'agent_version', v_new->'agent_version',
                         'tool_id', v_new->'tool_id', 'tool_version', v_new->'tool_version',
                         'max_level', v_new->'max_level', 'max_risk', v_new->'max_risk',
                         'expires_at', v_new->'expires_at', 'revoked', v_new->>'revoked_at' IS NOT NULL)
      || CASE WHEN v_old IS NOT NULL AND v_old->'max_risk' IS DISTINCT FROM v_new->'max_risk'
              THEN jsonb_build_object('max_risk_before', v_old->'max_risk') ELSE '{}'::jsonb END
      || CASE WHEN v_old IS NOT NULL AND v_old->'granted_by_user_id' IS DISTINCT FROM v_new->'granted_by_user_id'
              THEN jsonb_build_object('granted_by_user_id_before', v_old->'granted_by_user_id') ELSE '{}'::jsonb END
      || CASE WHEN v_old IS NOT NULL AND v_old->'revoked_by_user_id' IS DISTINCT FROM v_new->'revoked_by_user_id'
              THEN jsonb_build_object('revoked_by_user_id_before', v_old->'revoked_by_user_id') ELSE '{}'::jsonb END);
  ELSIF TG_TABLE_NAME IN ('agent_execution_enablement', 'agent_model_enablement') THEN
    IF v_old IS NOT NULL AND v_old->'enabled' = v_new->'enabled' THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal(NULL,
      CASE TG_TABLE_NAME WHEN 'agent_execution_enablement' THEN 'execution_enablement_changed' ELSE 'model_enablement_changed' END,
      v_new->>'updated_by',
      CASE TG_TABLE_NAME WHEN 'agent_execution_enablement' THEN 'execution_enablement' ELSE 'model_enablement' END,
      'platform', v_new->>'reason_code',
      jsonb_build_object('enabled_before', v_old->'enabled', 'enabled', v_new->'enabled'));
  ELSIF TG_TABLE_NAME = 'agent_tool_controls' THEN
    IF v_old IS NOT NULL AND v_old->'paused' = v_new->'paused' THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal(NULL, 'tool_control_changed', v_new->>'updated_by', 'tool_control',
      v_new->>'tool_id', v_new->>'reason_code',
      jsonb_build_object('tool_id', v_new->'tool_id', 'paused_before', v_old->'paused', 'paused', v_new->'paused'));
  ELSIF TG_TABLE_NAME = 'agent_customer_billing_controls' THEN
    IF v_old IS NOT NULL AND (v_old->'customer_billing_mode', v_old->'stripe_trueup_enabled')
                           = (v_new->'customer_billing_mode', v_new->'stripe_trueup_enabled') THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal(NULL, 'customer_billing_controls_changed', v_new->>'updated_by',
      'customer_billing_controls', 'platform', v_new->>'reason_code',
      jsonb_build_object('mode_before', v_old->'customer_billing_mode', 'mode', v_new->'customer_billing_mode',
                         'stripe_trueup_enabled_before', v_old->'stripe_trueup_enabled',
                         'stripe_trueup_enabled', v_new->'stripe_trueup_enabled'));
  ELSIF TG_TABLE_NAME = 'agent_worker_credentials' THEN
    PERFORM public.agent__control_center_journal(NULL,
      CASE WHEN TG_OP = 'INSERT' THEN 'worker_credential_issued' ELSE 'worker_credential_revoked' END,
      CASE WHEN TG_OP = 'INSERT' THEN v_new->>'issued_by' ELSE v_new->>'revoked_by' END,
      'worker_credential', v_new->>'id', v_new->>'revoke_reason',
      jsonb_build_object('label', v_new->'label', 'app_env', v_new->'app_env', 'expires_at', v_new->'expires_at'));
  END IF;
  RETURN NULL;
END;
$function$;
-- CREATE OR REPLACE keeps the ACL; re-assert that no role may call the journal trigger function.
REVOKE ALL ON FUNCTION public.agent__journal_control_change() FROM PUBLIC, anon, authenticated, service_role, agent_worker;

-- -----------------------------------------------------------------------------
-- (3) Postconditions
-- -----------------------------------------------------------------------------
DO $post$
DECLARE
  v_bad text;
BEGIN
  SELECT pg_catalog.string_agg(x.t, ', ') INTO v_bad
    FROM unnest(ARRAY['agent_runtime_controls', 'agent_tool_controls', 'agent_tool_grants', 'agent_tool_approvals']) AS x(t)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tr
                      WHERE tr.tgrelid = pg_catalog.format('public.%I', x.t)::pg_catalog.regclass
                        AND tr.tgname = 'agent_control_update_guard' AND tr.tgenabled = 'O' AND tr.tgtype = 19
                        AND tr.tgfoid = 'public.agent__guard_control_update()'::pg_catalog.regprocedure);
  IF v_bad IS NOT NULL
     OR (SELECT count(*) FROM pg_catalog.pg_trigger
          WHERE tgfoid = 'public.agent__guard_control_update()'::pg_catalog.regprocedure) <> 4 THEN
    RAISE EXCEPTION 'migration 260 update guard missing or misplaced: %', coalesce(v_bad, 'trigger count')
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                  WHERE oid = 'public.agent__journal_control_change()'::pg_catalog.regprocedure AND prosecdef
                    AND proowner = 'postgres'::pg_catalog.regrole AND proconfig = ARRAY['search_path=""'])
     OR (SELECT count(*) FROM pg_catalog.pg_trigger
          WHERE tgname = 'agent_control_center_journal' AND tgenabled = 'O'
            AND tgfoid = 'public.agent__journal_control_change()'::pg_catalog.regprocedure) <> 7 THEN
    RAISE EXCEPTION 'migration 260 journal trigger function or its 7 triggers changed shape' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations()) THEN
    RAISE EXCEPTION 'agent audit privilege violations after migration 260' USING ERRCODE = '42501';
  END IF;
END
$post$;
