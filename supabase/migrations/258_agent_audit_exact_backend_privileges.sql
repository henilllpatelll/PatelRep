-- =============================================================================
-- Migration 258: exact backend privilege matrix on the protected agent harness tables
-- =============================================================================
-- migration-safety: privilege-only (two CREATE OR REPLACE of existing SECURITY INVOKER functions, same signatures, plus
--   REVOKEs of rights no migration ever granted; nothing dropped, renamed or rewritten; no row changes)
-- rollback-plan: forward-only. Re-granting a removed right would need a new reviewed migration; the functions'
--   previous bodies are in migration 256 and scripts/schema-contracts.sql refuses any drift once this name is recorded.
--
-- Why: the 33 registered H1-H6 tables were granted to service_role exactly as
--   SELECT, INSERT, UPDATE (21 mutable tables) / SELECT, INSERT (11 append-only) / SELECT (the H6 journal).
--   CI and Staging Candidate then run `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role` for their fixtures.
--   agent_audit_privileges_enforce() (254, 256) removed only an enumerated subset afterwards, so persistent staging
--   kept REFERENCES, TRIGGER and MAINTAIN on all 33, the journal included (its reviewed postcondition requires SELECT
--   only). DELETE on the 21 mutable tables stays: the reviewed 254/H6 postcondition service_role_backend_rights_preserved
--   requires it, so removing it is a separate decision (variant B2), not part of this fix. TRIGGER lets the
--   holder attach a trigger to a table that SECURITY DEFINER code writes to (for example the journal, written as the
--   table owner); the trigger then runs in that privileged context.
-- What changes:
--   * agent_audit_privilege_violations() becomes an allowlist: every right in the server's table-privilege universe
--     (derived from acldefault, so MAINTAIN and any future right are covered) held by PUBLIC, anon, authenticated or
--     agent_worker, or held by service_role outside the matrix above (plus the tolerated DELETE on mutable tables),
--     table- or column-level, direct or inherited, from any grantor, is a violation. The two H6 checks (journal
--     writer EXECUTE, agent_worker_privilege_violations()) are kept unchanged.
--   * The same fixture grant gives service_role TRIGGER, REFERENCES and MAINTAIN on every other table in public, and
--     several of those are written by SECURITY DEFINER code; any of these rights held by PUBLIC, anon, authenticated,
--     service_role or agent_worker on any relation in public is now a violation too (no application path uses them).
--   * agent_audit_privileges_enforce() revokes exactly what the violation function reports on those relations, so
--     the detector and the remover cannot diverge, then fails closed as before if anything remains (a right inherited
--     through role membership or granted by a non-owner grantor is not revocable here and therefore fails closed).
--     Repeated calls are no-ops. CI and Staging Candidate call it in the same transaction as their blanket grant.
--   Same signatures, SECURITY INVOKER, empty search_path, owner-only EXECUTE (CREATE OR REPLACE keeps the ACL).
--   Minimum vs maximum: the detector's matrix is the MAXIMUM a role may hold; the final check below asserts the MINIMUM
--   service_role must keep, listed per table from the creating migrations' grants (see the comment there).
-- Coordination: #239 (worker tenant binding) follows as 259; a table it registers needs its matrix row here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agent_audit_privilege_violations()
RETURNS TABLE (table_name text, role_name text, privilege text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  WITH registry AS (
    SELECT t.table_name, t.append_only, pg_catalog.format('public.%I', t.table_name)::pg_catalog.regclass AS rel
      FROM public.agent__audit_protected_tables() t
  ), universe AS (
    -- every right a table can carry on this server (PostgreSQL 17: arwdDxtm); oid 10 is the bootstrap superuser
    SELECT DISTINCT a.privilege_type AS privilege
      FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', 10::pg_catalog.oid)) a
  ), allowed AS (
    -- the reviewed backend matrix (migrations 238-256 grant S/I/U, S/I and S; DELETE on mutable tables is the reviewed
    -- 254/H6 backend right)
    SELECT r.table_name, p.privilege
      FROM registry r
     CROSS JOIN LATERAL unnest(CASE
             WHEN r.table_name = 'agent_control_center_events' THEN ARRAY['SELECT']
             WHEN r.append_only THEN ARRAY['SELECT', 'INSERT']
             -- DELETE is tolerated, not required: the reviewed 254/H6 postcondition service_role_backend_rights_preserved
             -- keeps it on the mutable tables (unjournaled control-row deletion is a separately tracked finding)
             ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
           END) AS p(privilege)
  ), held AS (
    SELECT r.table_name, g.role_name, u.privilege
      FROM registry r
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
     CROSS JOIN universe u
     WHERE pg_catalog.has_table_privilege(g.role_name, r.rel, u.privilege)
        OR (u.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            AND pg_catalog.has_any_column_privilege(g.role_name, r.rel, u.privilege))
  ), structural AS (
    -- schema-changing rights on ANY relation in public; no application role needs them (only migrations, as owner)
    SELECT c.relname::text AS table_name, g.role_name, u.privilege
      FROM pg_catalog.pg_class c
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
     CROSS JOIN universe u
     WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND u.privilege IN ('TRIGGER', 'REFERENCES', 'MAINTAIN')
       AND c.relname NOT IN (SELECT r.table_name FROM registry r)
       AND (pg_catalog.has_table_privilege(g.role_name, c.oid, u.privilege)
            OR (u.privilege = 'REFERENCES' AND pg_catalog.has_any_column_privilege(g.role_name, c.oid, u.privilege)))
  )
  SELECT x.table_name, x.role_name, x.privilege FROM (
    -- 258: nothing for end users, PUBLIC or the worker; service_role only within the matrix
    SELECT h.table_name, h.role_name, h.privilege
      FROM held h
     WHERE h.role_name <> 'service_role'
        OR NOT EXISTS (SELECT 1 FROM allowed a WHERE a.table_name = h.table_name AND a.privilege = h.privilege)
    UNION ALL
    -- 258: TRIGGER/REFERENCES/MAINTAIN on every other relation in public (a trigger attached by a non-owner runs as
    --      whoever writes the table, including SECURITY DEFINER code running as the owner)
    SELECT s.table_name, s.role_name, s.privilege FROM structural s
    UNION ALL
    -- 256: the journal writer (SECURITY DEFINER) is executable by no role; only owner-defined triggers call it
    SELECT 'agent__control_center_journal', r.role_name, 'EXECUTE'
      FROM unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS r(role_name)
     WHERE pg_catalog.has_function_privilege(r.role_name,
             'public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)'::pg_catalog.regprocedure,
             'EXECUTE')
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
  v_row   record;
  v_fn    record;
  v_left  text;
  v_count integer;
BEGIN
  -- Remove exactly what the detector reports on relations in public: any right on a registered table, and the
  -- structural rights (TRIGGER, REFERENCES, MAINTAIN) elsewhere. A table-level REVOKE also clears the same right
  -- granted per column. A right that reaches a role only through membership survives and fails closed below.
  FOR v_row IN SELECT DISTINCT v.table_name, v.role_name, v.privilege
                 FROM public.agent_audit_privilege_violations() v
                 JOIN pg_catalog.pg_class c ON c.relname = v.table_name
                  AND c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                WHERE v.role_name IN ('public', 'anon', 'authenticated', 'service_role', 'agent_worker')
                  AND v.privilege IN (SELECT DISTINCT a.privilege_type
                                        FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', 10::pg_catalog.oid)) a)
                  AND (v.table_name IN (SELECT t.table_name FROM public.agent__audit_protected_tables() t)
                       OR v.privilege IN ('TRIGGER', 'REFERENCES', 'MAINTAIN')) LOOP
    EXECUTE pg_catalog.format('REVOKE %s ON TABLE public.%I FROM %s', v_row.privilege, v_row.table_name,
      CASE v_row.role_name WHEN 'public' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_row.role_name) END);
  END LOOP;
  REVOKE ALL ON FUNCTION public.agent__control_center_journal(uuid, text, text, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role, agent_worker;
  FOR v_fn IN SELECT p.oid::pg_catalog.regprocedure AS sig FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::pg_catalog.regnamespace AND p.proname LIKE 'agent\_worker\_rpc\_\_%' LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn.sig);
  END LOOP;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s:%s', v.table_name, v.role_name, v.privilege), ', ') INTO v_left
    FROM public.agent_audit_privilege_violations() v;
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'agent audit privileges could not be enforced; still granted: %', v_left USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_count FROM public.agent__audit_protected_tables();
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.agent_audit_privilege_violations() IS
  'Allowlist check (migration 258) for the protected harness tables: any table right of PUBLIC, anon, authenticated or agent_worker, any service_role right outside SELECT/INSERT/UPDATE/DELETE (mutable), SELECT/INSERT (append-only) or SELECT (H6 journal), table- or column-level; TRIGGER/REFERENCES/MAINTAIN of those roles on any relation in public; plus the H6 journal-writer and worker-identity checks.';
COMMENT ON FUNCTION public.agent_audit_privileges_enforce() IS
  'Revokes exactly the rights agent_audit_privilege_violations() reports on the protected harness tables after any blanket grant, re-asserts the H6 function revocations, and fails closed if a forbidden right remains. Run as the table owner (migrations, CI, Staging Candidate).';

-- CREATE OR REPLACE keeps the owner-only ACLs from 254/256; re-assert them anyway.
REVOKE ALL ON FUNCTION public.agent_audit_privilege_violations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.agent_audit_privileges_enforce() FROM PUBLIC, anon, authenticated, service_role;

-- Repair the current state (removes the fixture leftovers on persistent staging; a no-op where none exist).
SELECT public.agent_audit_privileges_enforce();

-- Fail closed unless the matrix is now exact: no violation, and service_role still holds every right its creating
-- migration granted. The minimum is listed per table from the released grants (238, 241, 244, 247, 248, 250, 252, 255,
-- 256), NOT derived from append_only: agent_model_price_schedules is registered mutable (append_only = false, so UPDATE
-- and DELETE stay tolerated by the maximum above) but 244 granted it only SELECT, INSERT (rows are immutable; closing
-- effective_to is done by migrations as the owner). Requiring UPDATE there failed on every clean replay.
DO $post$
DECLARE
  -- table -> rights its creating migration granted to service_role (the reviewed minimum)
  v_minimum constant jsonb := jsonb_build_object(
    -- 238 (H1)
    'agent_runs', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_run_steps', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_run_events', '["SELECT","INSERT"]'::jsonb, 'agent_runtime_controls', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_worker_heartbeats', '["SELECT","INSERT","UPDATE"]'::jsonb,
    -- 241 (H2)
    'agent_execution_enablement', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_tool_controls', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_tool_grants', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_tool_approvals', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_tool_invocations', '["SELECT","INSERT"]'::jsonb,
    'agent_tool_executions', '["SELECT","INSERT"]'::jsonb, 'agent_tool_events', '["SELECT","INSERT"]'::jsonb,
    -- 244, 247 (H3); price schedules: SELECT, INSERT only (244)
    'agent_model_enablement', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_budget_policies', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_budget_counters', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_attempts', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_model_price_schedules', '["SELECT","INSERT"]'::jsonb, 'agent_model_spend_events', '["SELECT","INSERT"]'::jsonb,
    'agent_planning_runs', '["SELECT","INSERT","UPDATE"]'::jsonb,
    -- 248, 250 (H4)
    'agent_customer_billing_controls', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_pricing_policies', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_credit_holds', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_credit_charges', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_billing_operations', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'agent_customer_overage_authorizations', '["SELECT","INSERT"]'::jsonb,
    'agent_customer_billing_events', '["SELECT","INSERT"]'::jsonb, 'agent_billing_operation_events', '["SELECT","INSERT"]'::jsonb,
    'billing_trueup_operations', '["SELECT","INSERT","UPDATE"]'::jsonb,
    'billing_trueup_operation_events', '["SELECT","INSERT"]'::jsonb,
    -- 252 (H5)
    'agent_planning_events', '["SELECT","INSERT"]'::jsonb, 'agent_proposal_handoffs', '["SELECT","INSERT"]'::jsonb,
    -- 255, 256 (H6)
    'agent_worker_credentials', '["SELECT","INSERT","UPDATE"]'::jsonb, 'agent_control_center_events', '["SELECT"]'::jsonb);
  v_missing  text;
  v_unlisted text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations()) THEN
    RAISE EXCEPTION 'agent audit privilege violations remain after migration 258' USING ERRCODE = '42501';
  END IF;
  -- The minimum must cover exactly the registry (a newly registered table needs its entry here and in the contract).
  SELECT pg_catalog.string_agg(coalesce(t.table_name, m.key), ', ') INTO v_unlisted
    FROM public.agent__audit_protected_tables() t
    FULL JOIN pg_catalog.jsonb_object_keys(v_minimum) AS m(key) ON m.key = t.table_name
   WHERE t.table_name IS NULL OR m.key IS NULL;
  IF v_unlisted IS NOT NULL THEN
    RAISE EXCEPTION 'migration 258 minimum matrix does not match the protected registry: %', v_unlisted USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', m.key, p.privilege), ', ') INTO v_missing
    FROM pg_catalog.jsonb_each(v_minimum) AS m(key, rights)
   CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(m.rights) AS p(privilege)
   WHERE NOT pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', m.key), p.privilege);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role lost a reviewed backend right: %', v_missing USING ERRCODE = '42501';
  END IF;
END
$post$;
