-- =============================================================================
-- Migration 256: Agent Harness H6 -- AI Control Center governance journal, read models and audited human controls
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. Nothing is dropped, renamed, deleted or rewritten, and no H0-H5 function body changes
--   except the three migration-254 privilege functions, which are replaced by strict supersets (same signatures, same
--   SECURITY INVOKER / empty search_path / owner-only grants). The destructive-SQL guard flags this file only because
--   it contains the TRUNCATE keyword (the extended 254 registry, its REVOKE TRUNCATE and a BEFORE TRUNCATE refusal
--   trigger on the new journal). Exact effect:
--   (1) agent_control_center_events: append-only, metadata-only journal of control-plane changes. Rows are written
--       ONLY by AFTER triggers on the control tables (so the operator CLI, the Control Center and any legacy path are
--       journaled in the same transaction as the change) and by one reviewed refusal recorder. No role holds INSERT,
--       UPDATE, DELETE or TRUNCATE on it; service_role reads it.
--   (2) the 254 registry grows by the two H6 tables (33 tables, 12 append-only); privilege enforcement additionally
--       strips every right of agent_worker on protected tables, INSERT on the journal, and EXECUTE on the worker
--       wrappers for every role except agent_worker, then fails closed (worker violations included);
--   (3) read models for the Control Center (overview, runs, approvals, approval facts, grants, journal), each filtered
--       by p_tenant_id in SQL and bounded;
--   (4) two audited human controls that reuse H1: a GM hotel pause/unpause (an operator-set pause cannot be cleared
--       from the Control Center) and GM/initiator run cancel/pause, GM resume. Both re-read the caller's CURRENT role
--       (agent__human_authority). Neither can enable execution, paid calls, billing or any autonomy level.
--   Approve/reject stay on H2's agent_tool_approval_decide and grant revocation on H2's agent_tool_grant_set; neither
--   is redefined. Agent execution, paid model calls and customer billing stay disabled (no switch changes here).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) The governance journal
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_control_center_events (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid        REFERENCES public.tenants(id) ON DELETE CASCADE,  -- NULL = platform-wide control
  event_type    text        NOT NULL CHECK (event_type IN (
                  'runtime_control_changed', 'tool_grant_changed', 'execution_enablement_changed',
                  'tool_control_changed', 'model_enablement_changed', 'customer_billing_controls_changed',
                  'worker_credential_issued', 'worker_credential_revoked', 'security_refusal')),
  actor_kind    text        NOT NULL CHECK (actor_kind IN ('human', 'operator', 'system')),
  actor_user_id uuid,
  actor_ref     text        CHECK (actor_ref ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  subject_type  text        NOT NULL CHECK (subject_type IN (
                  'runtime_control', 'tool_grant', 'execution_enablement', 'tool_control', 'model_enablement',
                  'customer_billing_controls', 'worker_credential', 'approval', 'run', 'control', 'grant')),
  subject_ref   text        CHECK (subject_ref ~ '^[A-Za-z0-9._:@/-]{1,200}$'),
  reason_code   text        CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb
                            CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_control_center_events_actor CHECK (
    (actor_kind = 'human' AND actor_user_id IS NOT NULL) OR (actor_kind <> 'human' AND actor_user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_control_center_events_tenant
  ON public.agent_control_center_events (tenant_id, id DESC);

ALTER TABLE public.agent_control_center_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_control_center_events FROM PUBLIC, anon, authenticated, service_role, agent_worker;
GRANT SELECT ON TABLE public.agent_control_center_events TO service_role;

-- Immutable. A hotel's rows go only with the hotel (offboarding cascade); platform rows (tenant_id NULL) never go.
CREATE OR REPLACE FUNCTION public.agent__guard_control_center_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.tenant_id IS NULL
     OR EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    RAISE EXCEPTION 'agent_control_center_events is append-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_control_center_events_immutable'
                  AND tgrelid = 'public.agent_control_center_events'::regclass) THEN
    CREATE TRIGGER agent_control_center_events_immutable BEFORE UPDATE OR DELETE ON public.agent_control_center_events
      FOR EACH ROW EXECUTE FUNCTION public.agent__guard_control_center_event();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_refuse_truncate'
                  AND tgrelid = 'public.agent_control_center_events'::regclass) THEN
    CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_control_center_events
      FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
  END IF;
END;
$trg$;

-- The single writer. SECURITY DEFINER so no application role needs INSERT on the journal. Callers are the trigger
-- functions below and agent_control_center_record_refusal; it is executable by no role.
CREATE OR REPLACE FUNCTION public.agent__control_center_journal(
  p_tenant_id uuid, p_event_type text, p_actor text, p_subject_type text, p_subject_ref text, p_reason_code text,
  p_detail jsonb
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_actor text := COALESCE(p_actor, 'system');
  v_user  uuid;
BEGIN
  IF v_actor ~ '^user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_user := substr(v_actor, 6)::uuid;
  END IF;
  INSERT INTO public.agent_control_center_events (tenant_id, event_type, actor_kind, actor_user_id, actor_ref,
                                                   subject_type, subject_ref, reason_code, detail)
  VALUES (p_tenant_id, p_event_type,
          CASE WHEN v_user IS NOT NULL THEN 'human' WHEN v_actor = 'system' THEN 'system' ELSE 'operator' END,
          v_user,
          CASE WHEN v_user IS NULL AND v_actor ~ '^[A-Za-z0-9._:@-]{1,100}$' THEN v_actor END,
          p_subject_type, left(p_subject_ref, 200),
          CASE WHEN p_reason_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason_code END,
          COALESCE(p_detail, '{}'::jsonb));
END;
$function$;

-- (1a) Journal triggers: every change to a control table, from any path, in the same transaction.
CREATE OR REPLACE FUNCTION public.agent__journal_control_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  IF TG_TABLE_NAME = 'agent_runtime_controls' THEN
    IF v_old IS NOT NULL AND (v_old->'paused', v_old->'cost_emergency_stop') = (v_new->'paused', v_new->'cost_emergency_stop') THEN
      RETURN NULL;
    END IF;
    PERFORM public.agent__control_center_journal((v_new->>'tenant_id')::uuid, 'runtime_control_changed',
      v_new->>'updated_by', 'runtime_control', v_new->>'scope' || COALESCE(':' || (v_new->>'agent_id'), ''),
      v_new->>'reason_code',
      jsonb_build_object('scope', v_new->'scope', 'agent_id', v_new->'agent_id',
                         'paused_before', v_old->'paused', 'paused', v_new->'paused',
                         'cost_emergency_stop_before', v_old->'cost_emergency_stop',
                         'cost_emergency_stop', v_new->'cost_emergency_stop'));
  ELSIF TG_TABLE_NAME = 'agent_tool_grants' THEN
    IF v_old IS NOT NULL AND (v_old->'max_level', v_old->'revoked_at', v_old->'expires_at', v_old->'granted_at')
                           = (v_new->'max_level', v_new->'revoked_at', v_new->'expires_at', v_new->'granted_at') THEN
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
                         'expires_at', v_new->'expires_at', 'revoked', v_new->>'revoked_at' IS NOT NULL));
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

DO $journal$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['agent_runtime_controls', 'agent_tool_grants', 'agent_execution_enablement',
                                 'agent_model_enablement', 'agent_tool_controls', 'agent_customer_billing_controls',
                                 'agent_worker_credentials'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_control_center_journal'
                    AND tgrelid = format('public.%I', v_table)::regclass) THEN
      EXECUTE format('CREATE TRIGGER agent_control_center_journal AFTER INSERT OR UPDATE ON public.%I '
                     'FOR EACH ROW EXECUTE FUNCTION public.agent__journal_control_change()', v_table);
    END IF;
  END LOOP;
END;
$journal$;

-- (1b) Refusals the API decided (authority, tenant, staleness, races). Metadata only; never a person's free text.
CREATE OR REPLACE FUNCTION public.agent_control_center_record_refusal(
  p_tenant_id uuid, p_actor_user_id uuid, p_reason_code text, p_subject_type text, p_subject_ref text
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' OR p_subject_type NOT IN ('approval', 'run', 'control', 'grant') THEN
    RAISE EXCEPTION 'invalid refusal record' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RETURN;  -- nothing to attribute it to; never creates rows for unknown hotels
  END IF;
  PERFORM public.agent__control_center_journal(p_tenant_id, 'security_refusal',
    CASE WHEN p_actor_user_id IS NOT NULL THEN 'user:' || p_actor_user_id::text ELSE 'system' END,
    p_subject_type, CASE WHEN p_subject_ref ~ '^[A-Za-z0-9._:@/-]{1,200}$' THEN p_subject_ref END, p_reason_code,
    '{}'::jsonb);
END;
$function$;

-- -----------------------------------------------------------------------------
-- (2) Extend the migration-254 registry and privilege enforcement (strict supersets, same signatures)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__audit_protected_tables()
RETURNS TABLE (table_name text, append_only boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT v.table_name, v.append_only FROM (VALUES
    -- H1 (238)
    ('agent_runs', false), ('agent_run_steps', false), ('agent_run_events', true), ('agent_runtime_controls', false),
    ('agent_worker_heartbeats', false),
    -- H2 (241)
    ('agent_execution_enablement', false), ('agent_tool_controls', false), ('agent_tool_grants', false),
    ('agent_tool_invocations', true), ('agent_tool_approvals', false), ('agent_tool_executions', true),
    ('agent_tool_events', true),
    -- H3 (244, 247)
    ('agent_model_enablement', false), ('agent_model_price_schedules', false), ('agent_model_budget_policies', false),
    ('agent_model_budget_counters', false), ('agent_model_attempts', false), ('agent_model_spend_events', true),
    ('agent_planning_runs', false),
    -- H4 (248, 250)
    ('agent_customer_billing_controls', false), ('agent_customer_pricing_policies', false),
    ('agent_customer_overage_authorizations', true), ('agent_customer_credit_holds', false),
    ('agent_billing_operations', false), ('agent_customer_credit_charges', false),
    ('agent_customer_billing_events', true), ('agent_billing_operation_events', true),
    ('billing_trueup_operations', false), ('billing_trueup_operation_events', true),
    -- H5 (252)
    ('agent_planning_events', true), ('agent_proposal_handoffs', true),
    -- H6 (255, 256)
    ('agent_worker_credentials', false), ('agent_control_center_events', true)
  ) AS v(table_name, append_only);
$function$;

COMMENT ON FUNCTION public.agent__audit_protected_tables() IS
  'Reviewed registry (migrations 254, 256) of the 33 H1-H6 harness tables protected from TRUNCATE; append_only marks the 12 whose backend rights are SELECT and INSERT only (the H6 journal: SELECT only).';

CREATE OR REPLACE FUNCTION public.agent_audit_privilege_violations()
RETURNS TABLE (table_name text, role_name text, privilege text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT x.table_name, x.role_name, x.privilege FROM (
    -- 254: TRUNCATE anywhere; UPDATE/DELETE on append-only tables
    SELECT t.table_name, r.role_name, p.privilege
      FROM public.agent__audit_protected_tables() t
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) AS r(role_name)
     CROSS JOIN unnest(ARRAY['TRUNCATE', 'UPDATE', 'DELETE']) AS p(privilege)
     WHERE (p.privilege = 'TRUNCATE' OR t.append_only)
       AND CASE p.privilege
             WHEN 'UPDATE' THEN has_any_column_privilege(r.role_name, format('public.%I', t.table_name)::regclass, 'UPDATE')
             ELSE has_table_privilege(r.role_name, format('public.%I', t.table_name)::regclass, p.privilege)
           END
    UNION ALL
    -- 256: the journal is written only by its reviewed SECURITY DEFINER writer
    SELECT 'agent_control_center_events', r.role_name, 'INSERT'
      FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) AS r(role_name)
     WHERE has_any_column_privilege(r.role_name, 'public.agent_control_center_events'::regclass, 'INSERT')
    UNION ALL
    -- 256: the worker identity holds no right at all on harness tables
    SELECT t.table_name, 'agent_worker', p.privilege
      FROM public.agent__audit_protected_tables() t
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
     WHERE CASE WHEN p.privilege IN ('SELECT', 'INSERT', 'UPDATE')
                THEN has_any_column_privilege('agent_worker', format('public.%I', t.table_name)::regclass, p.privilege)
                ELSE has_table_privilege('agent_worker', format('public.%I', t.table_name)::regclass, p.privilege)
           END
    UNION ALL
    -- 256: the journal writer (SECURITY DEFINER) is executable by no role; only owner-defined triggers call it
    SELECT 'agent__control_center_journal', r.role_name, 'EXECUTE'
      FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS r(role_name)
     WHERE has_function_privilege(r.role_name,
             'public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)'::regprocedure, 'EXECUTE')
    UNION ALL
    -- 255: everything else the worker contract forbids (role attributes, functions, columns, wrapper grantees)
    SELECT w.object_name, 'agent_worker', w.violation FROM public.agent_worker_privilege_violations() w
  ) x
  ORDER BY 1, 2, 3;
$function$;

CREATE OR REPLACE FUNCTION public.agent_audit_privileges_enforce()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_table record;
  v_fn    record;
  v_left  text;
  v_count integer := 0;
BEGIN
  FOR v_table IN SELECT * FROM public.agent__audit_protected_tables() LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
                   v_table.table_name);
    IF v_table.append_only THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
                     v_table.table_name);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM agent_worker', v_table.table_name);
    v_count := v_count + 1;
  END LOOP;
  REVOKE INSERT ON TABLE public.agent_control_center_events FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role, agent_worker;
  FOR v_fn IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'agent\_worker\_rpc\_\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn.sig);
  END LOOP;
  SELECT string_agg(format('%s:%s:%s', v.table_name, v.role_name, v.privilege), ', ') INTO v_left
    FROM public.agent_audit_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent audit privileges could not be enforced; still granted: %', v_left USING ERRCODE = '42501';
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.agent_audit_privileges_enforce() IS
  'Re-asserts least privilege on the protected harness tables and the worker identity after any blanket grant and fails closed if a forbidden right remains. Run as the table owner (migrations, CI, Staging Candidate).';

-- -----------------------------------------------------------------------------
-- (3) Control Center read models (service_role; tenant-filtered in SQL; bounded)
-- -----------------------------------------------------------------------------
-- Approval history pages by hotel and recency (the H2 index covers only pending rows).
CREATE INDEX IF NOT EXISTS idx_agent_tool_approvals_tenant_created
  ON public.agent_tool_approvals (tenant_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.agent__control_center_run_json(r public.agent_runs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', r.id, 'agent_id', r.agent_id, 'agent_version', r.agent_version, 'state', r.state,
    'principal_type', r.principal_type, 'initiated_by_user_id', r.initiated_by_user_id,
    'system_principal_id', r.system_principal_id, 'trigger_type', r.trigger_type, 'correlation_id', r.correlation_id,
    'attempt_count', r.attempt_count, 'max_attempts', r.max_attempts, 'current_step_number', r.current_step_number,
    'last_error_class', r.last_error_class, 'last_error_code', r.last_error_code,
    'cancel_requested_at', r.cancel_requested_at, 'pause_requested_at', r.pause_requested_at,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'started_at', r.started_at,
    'completed_at', r.completed_at, 'deadline_at', r.deadline_at);
$function$;

CREATE OR REPLACE FUNCTION public.agent_control_center_runs_page(
  p_tenant_id uuid, p_states text[] DEFAULT NULL, p_initiated_by uuid DEFAULT NULL,
  p_before_created timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 25
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__control_center_run_json(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_runs
           WHERE tenant_id = p_tenant_id
             AND (p_states IS NULL OR state = ANY (p_states))
             AND (p_initiated_by IS NULL OR initiated_by_user_id = p_initiated_by)
             AND (p_before_created IS NULL OR (created_at, id) < (p_before_created, p_before_id))
           ORDER BY created_at DESC, id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)) r;
$function$;

CREATE OR REPLACE FUNCTION public.agent_control_center_approvals_page(
  p_tenant_id uuid, p_states text[] DEFAULT NULL, p_initiated_by uuid DEFAULT NULL,
  p_before_created timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 25
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(public.agent__approval_json(a) ORDER BY a.created_at DESC, a.id DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_tool_approvals
           WHERE tenant_id = p_tenant_id
             AND (p_states IS NULL OR state = ANY (p_states))
             AND (p_initiated_by IS NULL OR initiated_by_user_id = p_initiated_by)
             AND (p_before_created IS NULL OR (created_at, id) < (p_before_created, p_before_id))
           ORDER BY created_at DESC, id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)) a;
$function$;

-- Human-review facts for ONE approval: the bound proposal (reviewed argument keys only), the affected resource as it
-- is NOW (for staleness), and display names. Never guest data, notes typed by guests, prompts or model text.
CREATE OR REPLACE FUNCTION public.agent_control_center_approval_facts(p_tenant_id uuid, p_approval_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_a   public.agent_tool_approvals%ROWTYPE;
  v_inv public.agent_tool_invocations%ROWTYPE;
  v_args jsonb;
  v_resource jsonb;
  v_handoff jsonb;
BEGIN
  SELECT * INTO v_a FROM public.agent_tool_approvals WHERE id = p_approval_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_inv FROM public.agent_tool_invocations WHERE id = v_a.invocation_id AND tenant_id = p_tenant_id;
  -- Reviewed argument keys only; an explicit null (for example "currently unassigned") is kept, it is a fact.
  SELECT COALESCE(jsonb_object_agg(a.key, a.value), '{}'::jsonb) INTO v_args
    FROM jsonb_each(COALESCE(v_inv.arguments, '{}'::jsonb)) a
   WHERE a.key IN ('assignee_user_id', 'expected_assigned_to', 'assignment_date', 'note');
  IF v_a.resource_type = 'work_order' THEN
    SELECT jsonb_build_object('type', 'work_order', 'id', w.id, 'label', w.work_order_number, 'title', w.title,
                              'status', w.status, 'priority', w.priority, 'assigned_to', w.assigned_to,
                              'updated_at', w.updated_at, 'room_number', rm.room_number)
      INTO v_resource
      FROM public.work_orders w LEFT JOIN public.rooms rm ON rm.id = w.room_id AND rm.tenant_id = p_tenant_id
     WHERE w.id = v_a.resource_id AND w.tenant_id = p_tenant_id;
  ELSIF v_a.resource_type = 'room' THEN
    SELECT jsonb_build_object('type', 'room', 'id', rm.id, 'label', rm.room_number, 'status', rs.status,
                              'fo_status', rs.fo_status, 'assigned_to', rs.assigned_to, 'updated_at', rs.updated_at)
      INTO v_resource
      FROM public.rooms rm LEFT JOIN public.room_status rs ON rs.room_id = rm.id AND rs.tenant_id = p_tenant_id
     WHERE rm.id = v_a.resource_id AND rm.tenant_id = p_tenant_id;
  END IF;
  SELECT jsonb_build_object('id', h.id, 'planning_run_id', h.planning_run_id, 'intent', h.intent,
                            'intent_version', h.intent_version, 'step_number', h.step_number,
                            'proposal_expires_at', h.proposal_expires_at)
    INTO v_handoff FROM public.agent_proposal_handoffs h
   WHERE h.invocation_id = v_a.invocation_id AND h.tenant_id = p_tenant_id;
  RETURN jsonb_build_object(
    'approval', public.agent__approval_json(v_a),
    'proposal', jsonb_build_object('tool_id', v_a.tool_id, 'tool_version', v_a.tool_version,
                                   'agent_id', v_a.agent_id, 'agent_version', v_a.agent_version,
                                   'action_digest', v_a.action_digest, 'arguments', COALESCE(v_args, '{}'::jsonb)),
    'resource', v_resource,
    'handoff', v_handoff,
    'people', COALESCE((SELECT jsonb_object_agg(p.id::text, jsonb_build_object('name', p.full_name, 'active', p.is_active))
                          FROM public.user_profiles p
                         WHERE p.tenant_id = p_tenant_id
                           AND p.id IN (v_a.initiated_by_user_id, v_a.decided_by_user_id,
                                        public.agent__try_uuid(v_args->>'assignee_user_id'),
                                        public.agent__try_uuid(v_args->>'expected_assigned_to'),
                                        public.agent__try_uuid(v_resource->>'assigned_to'))), '{}'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent__try_uuid(p_value text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE WHEN p_value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              THEN p_value::uuid END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_control_center_grants(p_tenant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', g.id, 'agent_id', g.agent_id, 'agent_version', g.agent_version, 'tool_id', g.tool_id,
           'tool_version', g.tool_version, 'max_level', g.max_level, 'max_risk', g.max_risk,
           'granted_by_user_id', g.granted_by_user_id, 'granted_at', g.granted_at, 'expires_at', g.expires_at,
           'revoked_at', g.revoked_at, 'revoked_by_user_id', g.revoked_by_user_id,
           'effective', g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))
         ORDER BY g.agent_id, g.agent_version, g.tool_id, g.tool_version), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_tool_grants WHERE tenant_id = p_tenant_id
           ORDER BY agent_id, agent_version, tool_id, tool_version LIMIT 200) g;
$function$;

-- Hotel rows plus platform rows (operator identity reduced to its kind; a hotel never sees operator labels).
CREATE OR REPLACE FUNCTION public.agent_control_center_events_page(
  p_tenant_id uuid, p_before_id bigint DEFAULT NULL, p_limit integer DEFAULT 50, p_event_types text[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'scope', CASE WHEN e.tenant_id IS NULL THEN 'platform' ELSE 'hotel' END,
           'event_type', e.event_type, 'actor_kind', e.actor_kind,
           'actor_user_id', CASE WHEN e.tenant_id IS NOT NULL THEN e.actor_user_id END,
           'subject_type', e.subject_type, 'subject_ref', e.subject_ref, 'reason_code', e.reason_code,
           'detail', e.detail, 'created_at', e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.agent_control_center_events
           WHERE (tenant_id = p_tenant_id OR tenant_id IS NULL)
             AND (p_before_id IS NULL OR id < p_before_id)
             AND (p_event_types IS NULL OR event_type = ANY (p_event_types))
           ORDER BY id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)) e;
$function$;

-- One round trip for the Overview: effective controls (as the database will evaluate them), counts, liveness.
CREATE OR REPLACE FUNCTION public.agent_control_center_overview(p_tenant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'platform', jsonb_build_object(
      'gateway_execution_enabled', COALESCE((SELECT enabled FROM public.agent_execution_enablement WHERE id = 1), false),
      'paid_model_calls_enabled', COALESCE((SELECT enabled FROM public.agent_model_enablement WHERE id = 1), false),
      'customer_billing_mode', COALESCE((SELECT customer_billing_mode FROM public.agent_customer_billing_controls WHERE id = 1), 'disabled'),
      'paused', EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'platform' AND paused),
      'cost_emergency_stop', EXISTS (SELECT 1 FROM public.agent_runtime_controls WHERE scope = 'platform' AND cost_emergency_stop),
      'paused_agents', COALESCE((SELECT jsonb_agg(agent_id ORDER BY agent_id) FROM public.agent_runtime_controls
                                  WHERE scope = 'agent' AND paused), '[]'::jsonb),
      'paused_tools', COALESCE((SELECT jsonb_agg(tool_id ORDER BY tool_id) FROM public.agent_tool_controls WHERE paused), '[]'::jsonb),
      'live_workers', (SELECT count(*) FROM public.agent_worker_heartbeats
                        WHERE last_seen_at > now() - interval '2 minutes' AND status <> 'stopped')),
    'hotel', jsonb_build_object(
      'entitled', COALESCE((SELECT enabled FROM public.tenant_feature_flags
                             WHERE tenant_id = p_tenant_id AND feature_key = 'ai_agents'), false),
      'paused', COALESCE((SELECT paused FROM public.agent_runtime_controls
                           WHERE scope = 'hotel' AND tenant_id = p_tenant_id), false),
      'paused_by_kind', (SELECT CASE WHEN updated_by LIKE 'user:%' THEN 'human' ELSE 'operator' END
                           FROM public.agent_runtime_controls
                          WHERE scope = 'hotel' AND tenant_id = p_tenant_id AND paused),
      'paused_by_user_id', (SELECT public.agent__try_uuid(substr(updated_by, 6)) FROM public.agent_runtime_controls
                             WHERE scope = 'hotel' AND tenant_id = p_tenant_id AND paused AND updated_by LIKE 'user:%'),
      'effective_grants', (SELECT count(*) FROM public.agent_tool_grants
                            WHERE tenant_id = p_tenant_id AND revoked_at IS NULL
                              AND (expires_at IS NULL OR expires_at > now()))),
    'runs', jsonb_build_object(
      'active', (SELECT count(*) FROM public.agent_runs WHERE tenant_id = p_tenant_id
                  AND state IN ('queued', 'running', 'retry_wait', 'paused', 'cancel_requested', 'awaiting_approval')),
      'awaiting_approval', (SELECT count(*) FROM public.agent_runs WHERE tenant_id = p_tenant_id AND state = 'awaiting_approval'),
      'failed_24h', (SELECT count(*) FROM public.agent_runs WHERE tenant_id = p_tenant_id
                      AND state IN ('failed', 'dead_letter') AND completed_at > now() - interval '24 hours'),
      'succeeded_24h', (SELECT count(*) FROM public.agent_runs WHERE tenant_id = p_tenant_id
                         AND state = 'succeeded' AND completed_at > now() - interval '24 hours')),
    'approvals', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.agent_tool_approvals WHERE tenant_id = p_tenant_id
                   AND state = 'requested' AND expires_at > now()),
      'expiring_1h', (SELECT count(*) FROM public.agent_tool_approvals WHERE tenant_id = p_tenant_id
                       AND state = 'requested' AND expires_at > now() AND expires_at <= now() + interval '1 hour')),
    'refusals_24h', (SELECT count(*) FROM public.agent_control_center_events WHERE tenant_id = p_tenant_id
                      AND event_type = 'security_refusal' AND created_at > now() - interval '24 hours'),
    'as_of', now());
$function$;

-- -----------------------------------------------------------------------------
-- (4) Audited human controls (reuse H1; current authority re-read in the same transaction)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_control_center_hotel_pause_set(
  p_tenant_id uuid, p_actor_user_id uuid, p_paused boolean, p_reason_code text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_current public.agent_runtime_controls%ROWTYPE;
BEGIN
  IF p_paused IS NULL OR p_reason_code IS NULL OR p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  IF public.agent__human_authority(p_tenant_id, p_actor_user_id, ARRAY['gm']) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  SELECT * INTO v_current FROM public.agent_runtime_controls
   WHERE scope = 'hotel' AND tenant_id = p_tenant_id FOR UPDATE;
  IF FOUND AND v_current.paused = p_paused THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'paused', p_paused);
  END IF;
  -- A pause an operator placed (incident response) is cleared only by an operator.
  IF FOUND AND v_current.paused AND NOT p_paused AND v_current.updated_by NOT LIKE 'user:%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operator_pause_locked');
  END IF;
  PERFORM public.agent_runtime_control_set('hotel', p_tenant_id, NULL, p_paused, false,
                                           'user:' || p_actor_user_id::text, p_reason_code);
  RETURN jsonb_build_object('ok', true, 'changed', true, 'paused', p_paused);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_control_center_run_control(
  p_tenant_id uuid, p_actor_user_id uuid, p_run_id uuid, p_action text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_run  public.agent_runs%ROWTYPE;
  v_role text;
  v_by   text := 'user:' || p_actor_user_id::text;
BEGIN
  IF p_action NOT IN ('cancel', 'pause', 'resume') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO v_run FROM public.agent_runs WHERE id = p_run_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  v_role := public.agent__human_authority(p_tenant_id, p_actor_user_id,
                                          ARRAY['gm', 'chief_engineer', 'engineer', 'housekeeping_supervisor']);
  IF v_role IS NULL
     OR (v_role <> 'gm' AND (p_action = 'resume' OR v_run.initiated_by_user_id IS DISTINCT FROM p_actor_user_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  RETURN CASE p_action
           WHEN 'cancel' THEN public.agent_run_request_cancel(p_tenant_id, p_run_id, v_by)
           WHEN 'pause' THEN public.agent_run_request_pause(p_tenant_id, p_run_id, v_by)
           ELSE public.agent_run_resume(p_tenant_id, p_run_id, v_by)
         END;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Privileges: read models and controls are service_role only; the writer and guards are internal
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__guard_control_center_event() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__journal_control_change() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
REVOKE ALL ON FUNCTION public.agent__audit_protected_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privilege_violations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privileges_enforce() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent__try_uuid(text) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent__control_center_run_json(public.agent_runs) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_record_refusal(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_runs_page(uuid, text[], uuid, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_approvals_page(uuid, text[], uuid, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_approval_facts(uuid, uuid) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_grants(uuid) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_events_page(uuid, bigint, integer, text[]) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_overview(uuid) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_hotel_pause_set(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated, agent_worker;
REVOKE ALL ON FUNCTION public.agent_control_center_run_control(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, agent_worker;
GRANT EXECUTE ON FUNCTION public.agent__try_uuid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent__control_center_run_json(public.agent_runs) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_record_refusal(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_runs_page(uuid, text[], uuid, timestamptz, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_approvals_page(uuid, text[], uuid, timestamptz, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_approval_facts(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_grants(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_events_page(uuid, bigint, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_overview(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_hotel_pause_set(uuid, uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_control_center_run_control(uuid, uuid, uuid, text) TO service_role;

-- Apply and verify least privilege now (fails the migration if anything forbidden remains).
SELECT public.agent_audit_privileges_enforce();

NOTIFY pgrst, 'reload schema';
