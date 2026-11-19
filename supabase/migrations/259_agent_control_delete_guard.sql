-- =============================================================================
-- Migration 259: no DELETE of agent safety controls, grants or approvals (H6 follow-up)
-- =============================================================================
-- migration-safety: privilege + trigger only (one CREATE OR REPLACE of an existing SECURITY INVOKER function with the
--   same signature, one new SECURITY INVOKER trigger function, 7 BEFORE DELETE row triggers, the DELETE right removed
--   from service_role on the protected registry). Nothing dropped, renamed or rewritten; no row changes.
-- rollback-plan: forward-only. Allowing a deletion again needs a new reviewed migration.
--
-- Why: service_role could DELETE rows whose ABSENCE the gates read as "no restriction" (platform / hotel / agent pause
--   and the cost emergency stop in agent_runtime_controls, tool pauses in agent_tool_controls, customer billing
--   enforcement in agent_customer_billing_controls). The Control Center journal triggers fire on INSERT/UPDATE only,
--   so such a DELETE lifted the restriction with no record. Deleting a rejected/expired/consumed approval frees its
--   one-per-invocation slot and erases the decision; deleting a grant or an enablement row erases its history.
--   No application path, RPC, migration, seed or workflow deletes from these tables (2026-11-19 audit); rows leave
--   only through a tenant offboarding cascade (deleting the tenant row).
-- What changes:
--   * agent__guard_control_delete(): BEFORE DELETE row guard on the 7 control / grant / approval tables. It refuses
--     every DELETE, from any role including the owner, EXCEPT a hotel-scoped row whose tenant row no longer exists
--     (the referential cascade of a tenant deletion; same rule as 238/241/256's append-only guards). Platform rows
--     (tenant_id NULL), tool controls and the three singletons are never deletable. No session variable or trigger
--     depth is consulted: the only way to make the tenant row disappear is to delete the hotel itself.
--   * DELETE is revoked from service_role (and PUBLIC, anon, authenticated, agent_worker) on all 33 registered tables:
--     agent_audit_privilege_violations() no longer tolerates it, so agent_audit_privileges_enforce() (unchanged) removes
--     it here and again after every CI / Staging Candidate fixture GRANT ALL. Referential actions run as the owner, so
--     offboarding is unaffected.
--   * Fails closed if the guard function or any agent_control_delete_guard trigger already exists (never adopts an
--     out-of-band look-alike); the migration is therefore not re-runnable, by design.
--   * agent_worker_heartbeats gets no trigger (operational liveness, not a control; the owner may prune it) but loses
--     the service_role DELETE like every other registered table.
-- Supersedes: the reviewed 254/H6 postcondition service_role_backend_rights_preserved (requires DELETE on 20 tables
--   and UPDATE on price schedules; only ever true under the fixture GRANT ALL) is false from this migration on. The
--   reviewed staging-preview registry is historical evidence and is not edited.
-- Coordination: #239 (worker tenant binding) follows as 260.
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
    -- the reviewed backend matrix (migrations 238-256 grant S/I/U, S/I and S; 259 removed the fixture-only DELETE)
    SELECT r.table_name, p.privilege
      FROM registry r
     CROSS JOIN LATERAL unnest(CASE
             WHEN r.table_name = 'agent_control_center_events' THEN ARRAY['SELECT']
             WHEN r.append_only THEN ARRAY['SELECT', 'INSERT']
             -- 259: DELETE is no longer tolerated; rows leave only through a tenant offboarding cascade, which
             -- PostgreSQL runs as the table owner and the row guards admit (tenant row already gone)
             ELSE ARRAY['SELECT', 'INSERT', 'UPDATE']
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

-- Fail closed if any migration-259 object already exists before this migration ran (an out-of-band look-alike must
-- never be adopted as the reviewed guard).
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
              WHERE pronamespace = 'public'::pg_catalog.regnamespace AND proname = 'agent__guard_control_delete')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'agent_control_delete_guard') THEN
    RAISE EXCEPTION 'migration 259 objects (agent__guard_control_delete / agent_control_delete_guard) already exist; refusing to adopt them'
      USING ERRCODE = '42501';
  END IF;
END
$pre$;

CREATE FUNCTION public.agent__guard_control_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_TABLE_NAME IN ('agent_runtime_controls', 'agent_tool_grants', 'agent_tool_approvals') THEN
    v_tenant := (pg_catalog.to_jsonb(OLD) ->> 'tenant_id')::uuid;
  END IF;
  -- Tenant offboarding: the referential cascade of a tenant deletion reaches this row after the tenant row is gone.
  IF v_tenant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are never deleted; change them through the journaled control functions', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$function$;
REVOKE ALL ON FUNCTION public.agent__guard_control_delete() FROM PUBLIC, anon, authenticated, service_role, agent_worker;
COMMENT ON FUNCTION public.agent__guard_control_delete() IS
  'Migration 259: refuses DELETE on agent safety controls, grants and approvals for every role; admits only a hotel-scoped row whose tenant is already gone (tenant offboarding cascade).';

DO $trg$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['agent_runtime_controls', 'agent_tool_controls', 'agent_execution_enablement',
                                 'agent_model_enablement', 'agent_customer_billing_controls', 'agent_tool_grants',
                                 'agent_tool_approvals'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER agent_control_delete_guard BEFORE DELETE ON public.%I '
                              'FOR EACH ROW EXECUTE FUNCTION public.agent__guard_control_delete()', v_table);
  END LOOP;
END;
$trg$;

-- Re-assert owner-only EXECUTE on the replaced detector (CREATE OR REPLACE keeps the ACL).
REVOKE ALL ON FUNCTION public.agent_audit_privilege_violations() FROM PUBLIC, anon, authenticated, service_role;

-- Repair the current state: snapshot service_role's other rights, let the (unchanged) enforcer remove what the
-- tightened detector reports, and fail closed unless exactly DELETE was removed and nothing else.
DO $post$
DECLARE
  v_before text[];
  v_after  text[];
  v_bad    text;
BEGIN
  SELECT pg_catalog.array_agg(pg_catalog.format('%s:%s', t.table_name, p.privilege) ORDER BY 1) INTO v_before
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) AS p(privilege)
   WHERE pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', t.table_name), p.privilege);
  PERFORM public.agent_audit_privileges_enforce();
  SELECT pg_catalog.array_agg(pg_catalog.format('%s:%s', t.table_name, p.privilege) ORDER BY 1) INTO v_after
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) AS p(privilege)
   WHERE pg_catalog.has_table_privilege('service_role', pg_catalog.format('public.%I', t.table_name), p.privilege);
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'migration 259 changed a service_role right other than DELETE' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations()) THEN
    RAISE EXCEPTION 'agent audit privilege violations remain after migration 259' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s', t.table_name, g.role_name), ', ') INTO v_bad
    FROM public.agent__audit_protected_tables() t
   CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS g(role_name)
   WHERE pg_catalog.has_table_privilege(g.role_name, pg_catalog.format('public.%I', t.table_name), 'DELETE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE still held on a protected agent table: %', v_bad USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.string_agg(x.t, ', ') INTO v_bad
    FROM unnest(ARRAY['agent_runtime_controls', 'agent_tool_controls', 'agent_execution_enablement',
                      'agent_model_enablement', 'agent_customer_billing_controls', 'agent_tool_grants',
                      'agent_tool_approvals']) AS x(t)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tr
                      WHERE tr.tgrelid = pg_catalog.format('public.%I', x.t)::pg_catalog.regclass
                        AND tr.tgname = 'agent_control_delete_guard' AND tr.tgenabled = 'O' AND tr.tgtype = 11
                        AND tr.tgfoid = 'public.agent__guard_control_delete()'::pg_catalog.regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 259 delete guard missing on: %', v_bad USING ERRCODE = '42501';
  END IF;
END
$post$;
