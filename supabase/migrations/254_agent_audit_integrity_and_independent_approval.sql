-- =============================================================================
-- Migration 254: Agent Harness pre-H6 hardening -- append-only audit integrity (#230) and database-enforced
--                independent human approval for medium/high-risk tool writes (#231)
-- =============================================================================
-- migration-safety: destructive-reviewed
-- rollback-plan: forward-only. Nothing is dropped, renamed or deleted: no table, column, row, index, constraint,
--   policy or existing function body changes. The destructive-SQL guard flags this file only because it contains the
--   TRUNCATE keyword (statement-level BEFORE TRUNCATE refusal triggers and REVOKE TRUNCATE). Exact effect:
--   (1) every H1-H5 harness table gains a BEFORE TRUNCATE trigger that refuses the statement;
--   (2) TRUNCATE is revoked from PUBLIC, anon, authenticated and service_role on those 31 tables, and UPDATE/DELETE on
--       the 11 append-only tables (whose row triggers already refuse every UPDATE and every DELETE except a tenant
--       deletion cascade, which PostgreSQL runs as the table owner);
--   (3) agent_tool_approvals and agent_tool_executions gain BEFORE row triggers that derive approver independence from
--       the reviewed agent__gateway_tool_spec risk instead of the caller-supplied approver_may_be_initiator flag.
--   Only restrictions are added; every legitimate H1-H5 write path is unchanged. To undo a restriction, a NEW reviewed
--   forward migration must drop the specific trigger or re-grant the specific privilege; migration history is never
--   rewritten. Agent execution, paid model calls and billing stay disabled (no switch or flag changes here).
--
-- #230 design. Row triggers do not fire for TRUNCATE, and blanket "GRANT ALL ON ALL TABLES" steps in CI and Staging
--   Candidate re-grant privileges after every run, so privileges alone cannot be the control:
--   * PRIMARY (privilege-independent): agent__refuse_truncate() BEFORE TRUNCATE ... FOR EACH STATEMENT on all 31 tables
--     (it also fires for tables reached through TRUNCATE ... CASCADE), plus the existing append-only row triggers.
--   * DEFENCE IN DEPTH: agent_audit_privileges_enforce() revokes the unneeded rights and then fails closed if any role
--     still holds one (agent_audit_privilege_violations(), which also sees column-level and inherited privileges).
--     Workflows that grant blanket table rights call it in the same transaction (separate control-plane PR).
--   * One reviewed registry, agent__audit_protected_tables(), drives enforcement, verification and schema contracts.
--   Residual (documented, not changeable from a migration): the table owner (postgres) and superusers can disable or
--   drop triggers, re-grant privileges or set session_replication_role = replica; service_role cannot do any of these.
--
-- #231 design. agent__gateway_tool_spec (last defined in 253) is the trusted, reviewed classification:
--   * INSERT of an approval: the spec must exist and be a write with risk low|medium|high (else refused); medium/high
--     refuse approver_may_be_initiator = true; required_approver_roles must equal the spec roles; every binding column
--     must equal the invocation's.
--   * UPDATE of an approval (binding columns, the stored flag included, are already frozen by 241's guard): an
--     approval of a medium/high (or no longer allowlisted) tool can never be decided by its initiator; consumption
--     re-checks independence, expiry and that the consuming ledger row belongs to this approval and invocation.
--   * INSERT into the execution ledger: a succeeded write needs an approved, unconsumed, unexpired, exactly bound and
--     (for medium/high) independent approval. Failed outcomes are unchanged (they cause no side effect).
--   Low-risk policy is exactly as before (the stored flag is honoured); no low-risk write exists in the allowlist today.
--   Existing rows are not rewritten. Every new rule applies to the next write, so a legacy self-approvable row can no
--   longer be approved or consumed by its initiator; a read-only report (NOTICE) counts such rows during the apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- #230 (1) The reviewed registry of protected harness tables
-- -----------------------------------------------------------------------------
-- append_only = true: every UPDATE and DELETE is refused by a row trigger (tenant-deletion cascade excepted), so the
-- backend needs only SELECT and INSERT. append_only = false: mutable control/state/approval tables that legitimately
-- need UPDATE; they lose only TRUNCATE.
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
    ('agent_planning_events', true), ('agent_proposal_handoffs', true)
  ) AS v(table_name, append_only);
$function$;

COMMENT ON FUNCTION public.agent__audit_protected_tables() IS
  'Reviewed registry (migration 254) of the 31 H1-H5 harness tables protected from TRUNCATE; append_only marks the 11 whose backend rights are SELECT and INSERT only.';

-- -----------------------------------------------------------------------------
-- #230 (2) Privilege-independent TRUNCATE refusal
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__refuse_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% is protected agent audit/ledger state; TRUNCATE is refused', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_runs;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_run_steps;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_run_steps
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_run_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_run_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_runtime_controls;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_runtime_controls
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_worker_heartbeats;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_worker_heartbeats
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_execution_enablement;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_execution_enablement
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_controls;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_controls
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_grants;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_invocations;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_invocations
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_approvals;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_executions;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_executions
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_tool_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_tool_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_enablement;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_enablement
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_price_schedules;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_price_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_budget_policies;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_budget_policies
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_budget_counters;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_budget_counters
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_attempts;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_model_spend_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_model_spend_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_planning_runs;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_planning_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_billing_controls;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_billing_controls
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_pricing_policies;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_pricing_policies
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_overage_authorizations;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_overage_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_credit_holds;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_credit_holds
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_billing_operations;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_billing_operations
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_credit_charges;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_credit_charges
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_customer_billing_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_customer_billing_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_billing_operation_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_billing_operation_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.billing_trueup_operations;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.billing_trueup_operations
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.billing_trueup_operation_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.billing_trueup_operation_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_planning_events;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_planning_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();
DROP TRIGGER IF EXISTS agent_refuse_truncate ON public.agent_proposal_handoffs;
CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public.agent_proposal_handoffs
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent__refuse_truncate();

-- -----------------------------------------------------------------------------
-- #230 (3) Least privilege, re-assertable after any blanket grant
-- -----------------------------------------------------------------------------
-- Every (table, role, privilege) that must not exist. UPDATE uses has_any_column_privilege so a column-level grant
-- counts; both checks follow role membership. 'public' is the PUBLIC pseudo-role.
CREATE OR REPLACE FUNCTION public.agent_audit_privilege_violations()
RETURNS TABLE (table_name text, role_name text, privilege text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT t.table_name, r.role_name, p.privilege
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role']) AS r(role_name)
   CROSS JOIN unnest(ARRAY['TRUNCATE', 'UPDATE', 'DELETE']) AS p(privilege)
   WHERE (p.privilege = 'TRUNCATE' OR t.append_only)
     AND CASE p.privilege
           WHEN 'UPDATE' THEN has_any_column_privilege(r.role_name, format('public.%I', t.table_name)::regclass, 'UPDATE')
           ELSE has_table_privilege(r.role_name, format('public.%I', t.table_name)::regclass, p.privilege)
         END
   ORDER BY 1, 2, 3;
$function$;

-- Revokes every right listed above, then fails closed if any remains (for example a grant made by another grantor,
-- which only that grantor can revoke). Must run as the table owner; it is never granted to an application role.
CREATE OR REPLACE FUNCTION public.agent_audit_privileges_enforce()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_table record;
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
    v_count := v_count + 1;
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
  'Re-asserts least privilege on the protected harness tables after any blanket grant and fails closed if a forbidden right remains. Run as the table owner (migrations, CI, Staging Candidate).';

-- -----------------------------------------------------------------------------
-- #231 (1) Approvals: trusted risk, immutable binding, independent decision and consumption
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__guard_approval_independence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_spec        jsonb := public.agent__gateway_tool_spec(NEW.agent_id, NEW.agent_version, NEW.tool_id, NEW.tool_version);
  v_independent boolean;
  v_inv         public.agent_tool_invocations%ROWTYPE;
BEGIN
  -- Unknown spec or unknown risk: independence is required (fail closed).
  v_independent := COALESCE(v_spec->>'risk', 'unknown') <> 'low';

  IF TG_OP = 'INSERT' THEN
    IF v_spec IS NULL OR v_spec->>'access' IS DISTINCT FROM 'write'
       OR v_spec->>'risk' IS NULL OR v_spec->>'risk' NOT IN ('low', 'medium', 'high') THEN
      RAISE EXCEPTION 'approvals exist only for reviewed gateway writes' USING ERRCODE = 'P0001';
    END IF;
    IF v_independent AND NEW.approver_may_be_initiator THEN
      RAISE EXCEPTION 'a % risk tool write requires an approver other than its initiator', v_spec->>'risk'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.required_approver_roles IS DISTINCT FROM public.agent__spec_roles(v_spec) THEN
      RAISE EXCEPTION 'approver roles must equal the reviewed tool roles' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_inv FROM public.agent_tool_invocations WHERE id = NEW.invocation_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND
       OR (v_inv.run_id, v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version, v_inv.access,
           v_inv.resource_type, v_inv.resource_id, v_inv.action_digest, v_inv.initiated_by_user_id)
          IS DISTINCT FROM
          (NEW.run_id, NEW.agent_id, NEW.agent_version, NEW.tool_id, NEW.tool_version, 'write',
           NEW.resource_type, NEW.resource_id, NEW.action_digest, NEW.initiated_by_user_id) THEN
      RAISE EXCEPTION 'an approval must bind exactly its write invocation' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. Binding columns (approver_may_be_initiator, roles, expiry included) are already frozen by the H2 guard
  -- agent__guard_approval_update (migration 241); this trigger adds the risk-derived decision and consumption rules.
  IF NEW.state = 'approved' AND OLD.state IS DISTINCT FROM 'approved' THEN
    IF v_spec IS NULL THEN
      RAISE EXCEPTION 'the tool is no longer in the reviewed gateway allowlist' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.decided_by_user_id IS NULL
       OR ((v_independent OR NOT NEW.approver_may_be_initiator)
           AND NEW.decided_by_user_id = NEW.initiated_by_user_id) THEN
      RAISE EXCEPTION 'a % risk tool write cannot be approved by its initiator', v_spec->>'risk' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
    IF v_spec IS NULL THEN
      RAISE EXCEPTION 'the tool is no longer in the reviewed gateway allowlist' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.state <> 'approved' OR NEW.expires_at <= now() OR NEW.decided_by_user_id IS NULL
       OR ((v_independent OR NOT NEW.approver_may_be_initiator)
           AND NEW.decided_by_user_id = NEW.initiated_by_user_id) THEN
      RAISE EXCEPTION 'only an unexpired, independently approved write may be consumed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.agent_tool_executions e
                    WHERE e.id = NEW.consumed_by_execution_id AND e.tenant_id = NEW.tenant_id
                      AND e.invocation_id = NEW.invocation_id AND e.approval_id = NEW.id) THEN
      RAISE EXCEPTION 'an approval is consumed only by its own execution ledger row' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_tool_approvals_independence ON public.agent_tool_approvals;
CREATE TRIGGER agent_tool_approvals_independence BEFORE INSERT OR UPDATE ON public.agent_tool_approvals
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_approval_independence();

-- -----------------------------------------------------------------------------
-- #231 (2) Execution ledger: a succeeded write always carries a valid, independent approval
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent__guard_execution_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_inv  public.agent_tool_invocations%ROWTYPE;
  v_appr public.agent_tool_approvals%ROWTYPE;
  v_spec jsonb;
BEGIN
  SELECT * INTO v_inv FROM public.agent_tool_invocations WHERE id = NEW.invocation_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR (v_inv.run_id, v_inv.tool_id, v_inv.tool_version, v_inv.action_digest, v_inv.idempotency_key)
                  IS DISTINCT FROM (NEW.run_id, NEW.tool_id, NEW.tool_version, NEW.action_digest, NEW.idempotency_key) THEN
    RAISE EXCEPTION 'an execution must bind exactly its invocation' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.approval_id IS NOT NULL THEN
    SELECT * INTO v_appr FROM public.agent_tool_approvals WHERE id = NEW.approval_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND OR v_appr.invocation_id <> NEW.invocation_id THEN
      RAISE EXCEPTION 'an execution approval must belong to its invocation' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_inv.access = 'write' AND NEW.state = 'succeeded' THEN
    v_spec := public.agent__gateway_tool_spec(v_inv.agent_id, v_inv.agent_version, v_inv.tool_id, v_inv.tool_version);
    IF v_spec IS NULL OR NEW.approval_id IS NULL OR v_appr.state <> 'approved' OR v_appr.consumed_at IS NOT NULL
       OR v_appr.expires_at <= now() OR v_appr.decided_by_user_id IS NULL
       OR ((COALESCE(v_spec->>'risk', 'unknown') <> 'low' OR NOT v_appr.approver_may_be_initiator)
           AND v_appr.decided_by_user_id = v_inv.initiated_by_user_id) THEN
      RAISE EXCEPTION 'a succeeded tool write requires a valid independent approval' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agent_tool_executions_approval_guard ON public.agent_tool_executions;
CREATE TRIGGER agent_tool_executions_approval_guard BEFORE INSERT ON public.agent_tool_executions
  FOR EACH ROW EXECUTE FUNCTION public.agent__guard_execution_approval();

-- -----------------------------------------------------------------------------
-- Function privileges: guards and registry are internal; enforcement is owner-only
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agent__audit_protected_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent__refuse_truncate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privilege_violations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privileges_enforce() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent__guard_approval_independence() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent__guard_execution_approval() FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Apply least privilege now, and report (read-only) legacy approval rows the new rules now govern
-- -----------------------------------------------------------------------------
SELECT public.agent_audit_privileges_enforce();

DO $migration$
DECLARE
  v_flagged  integer;
  v_selfdone integer;
BEGIN
  SELECT count(*) INTO v_flagged FROM public.agent_tool_approvals a
   WHERE a.approver_may_be_initiator
     AND COALESCE(public.agent__gateway_tool_spec(a.agent_id, a.agent_version, a.tool_id, a.tool_version)->>'risk',
                  'unknown') <> 'low';
  SELECT count(*) INTO v_selfdone FROM public.agent_tool_approvals a
   WHERE a.state = 'approved' AND a.decided_by_user_id = a.initiated_by_user_id;
  RAISE NOTICE 'migration 254: % approval row(s) carry a self-approval flag on a medium/high/unknown-risk tool; % approved row(s) were decided by their initiator (history is kept; neither can now be approved or consumed by the initiator)',
    v_flagged, v_selfdone;
END;
$migration$;
