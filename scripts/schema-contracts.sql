-- Executed only against an isolated migrated database (CI or local Supabase).
-- Keep this focused: it protects high-impact API contracts, not every column.
DO $$
DECLARE
  readiness jsonb;
  rls_table text;
  h5_recorded integer;
  h5_present text[];
  h5_unexpected integer;
  hardening_recorded integer;
  hardening_present text[];
  h6_recorded integer;
  h6_present text[];
  protected_tables integer := 31;
  append_only_tables integer := 11;
  public_create_fixed integer;
  exact_privileges_recorded integer;
  delete_guard_recorded integer;
  delete_guard_drift text;
  update_guard_recorded integer;
  update_guard_drift text;
  exact_privilege_drift text;
  p1_recorded integer;
  p1_present text[];
  p1_reviewed_functions text[];
BEGIN
  SELECT public.app_schema_readiness() INTO readiness;
  IF readiness->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Schema contract failure: %', readiness;
  END IF;

  FOREACH rls_table IN ARRAY ARRAY[
    'room_status', 'room_assignments', 'tasks', 'work_orders', 'assets',
    'logbook_entries', 'lost_found_items', 'lost_found_claims', 'lost_found_returns',
    'shift_summary_generation_claims', 'shift_summary_credit_charges',
    'agent_runs', 'agent_run_steps', 'agent_run_events', 'agent_runtime_controls', 'agent_worker_heartbeats',
    'agent_tool_invocations', 'agent_tool_approvals', 'agent_tool_executions', 'agent_tool_events',
    'agent_tool_grants', 'agent_tool_controls', 'agent_execution_enablement',
    'agent_model_enablement', 'agent_model_price_schedules', 'agent_model_budget_policies',
    'agent_model_budget_counters', 'agent_model_attempts', 'agent_model_spend_events', 'agent_planning_runs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class relations
      JOIN pg_namespace namespaces ON namespaces.oid = relations.relnamespace
      WHERE namespaces.nspname = 'public'
        AND relations.relname = rls_table
        AND relations.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on required table: public.%', rls_table;
    END IF;
  END LOOP;

  -- Agent Harness H1: the dispatch queue must be durable (logged), and no execution RPC may be callable by end users.
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'patelrep_agent_runs_v1' AND NOT is_unlogged) THEN
    RAISE EXCEPTION 'Agent Harness queue patelrep_agent_runs_v1 is missing or unlogged';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc procs JOIN pg_namespace namespaces ON namespaces.oid = procs.pronamespace
    WHERE namespaces.nspname = 'public' AND procs.proname LIKE 'agent%'
      AND (has_function_privilege('anon', procs.oid, 'EXECUTE') OR has_function_privilege('authenticated', procs.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'An Agent Harness function is executable by anon or authenticated';
  END IF;
  -- H2: the shared work-order assignment operation is backend-only (human route + Tool Gateway).
  IF EXISTS (
    SELECT 1 FROM pg_proc procs JOIN pg_namespace namespaces ON namespaces.oid = procs.pronamespace
    WHERE namespaces.nspname = 'public' AND procs.proname = 'work_order_assign_apply'
      AND (has_function_privilege('anon', procs.oid, 'EXECUTE') OR has_function_privilege('authenticated', procs.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'work_order_assign_apply is executable by anon or authenticated';
  END IF;
  -- H3: the provider-spend ledger and planning runs are backend-only, never SECURITY DEFINER, and exactly as reviewed.
  IF EXISTS (
    SELECT 1 FROM pg_proc procs JOIN pg_namespace namespaces ON namespaces.oid = procs.pronamespace
    WHERE namespaces.nspname = 'public' AND procs.proname LIKE 'agent%' AND procs.prosecdef
      -- H6 (255/256, recorded): ONLY the reviewed worker wrappers, the credential check, the journal writer and its
      -- trigger, and the refusal recorder are SECURITY DEFINER (each audited in ADR-0005 §4). Nothing else, ever.
      AND NOT (EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations history
                        WHERE history.name = 'agent_control_center')
               AND (procs.proname LIKE 'agent\_worker\_rpc\_\_%'
                    OR procs.proname IN ('agent__worker_credential_ok', 'agent__worker_assert',
                                         'agent__control_center_journal', 'agent__journal_control_change',
                                         'agent_control_center_record_refusal'))
               -- An allowlisted name is no exemption for a definer with a mutable search_path.
               AND procs.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
      -- H6 P1 (261, recorded): the registry-bound tenant source evaluated by the RESTRICTIVE gates, and nothing else.
      AND NOT (EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations history
                        WHERE history.name = 'agent_worker_tenant_binding')
               AND procs.proname = 'agent__worker_tenant' AND procs.pronargs = 0
               AND procs.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
  ) THEN
    RAISE EXCEPTION 'An Agent Harness function is SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class relations
    JOIN pg_namespace namespaces ON namespaces.oid = relations.relnamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS end_users(role_name)
    WHERE namespaces.nspname = 'public' AND relations.relkind = 'r'
      AND (relations.relname LIKE 'agent_model_%' OR relations.relname = 'agent_planning_runs')
      AND (has_table_privilege(end_users.role_name, relations.oid, 'SELECT')
           OR has_table_privilege(end_users.role_name, relations.oid, 'INSERT')
           OR has_table_privilege(end_users.role_name, relations.oid, 'UPDATE')
           OR has_table_privilege(end_users.role_name, relations.oid, 'DELETE'))
  ) THEN
    RAISE EXCEPTION 'An H3 ledger or planning table is accessible to anon or authenticated';
  END IF;
  IF (SELECT count(*) FROM public.agent_model_enablement) <> 1 THEN
    RAISE EXCEPTION 'agent_model_enablement must hold exactly one row';
  END IF;
  IF (SELECT count(*) FROM public.agent_model_price_schedules WHERE schedule_version IN
        ('openai-2026-11-14', 'anthropic-2026-11-14')) <> 4 THEN
    RAISE EXCEPTION 'The reviewed H3 price book seed is missing';
  END IF;

  -- H5 (migrations 251-253, PR #223) is applied to staging by reviewed preview before it merges, so this same trusted
  -- copy must hold for BOTH schema versions. The version is read from migration history BY NAME (CI and local replays
  -- record synthetic version numbers, remote databases the real ones; the names are identical in both):
  --   none of the three recorded -> the H4 schema: the H3 agent allowlist and H3 planning checks, and NO H5 object;
  --   all three recorded         -> the complete H5 schema, checked below;
  --   anything else              -> a partially applied H5 schema, which fails closed.
  -- An H5 object without its recorded migration (or the reverse) also fails closed.
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Migration history (supabase_migrations.schema_migrations) is missing; the H5 schema version cannot be proven';
  END IF;
  SELECT count(DISTINCT history.name) INTO h5_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name IN ('agent_h5_specialist_allowlists', 'agent_h5_planning_and_handoff', 'agent_h5_gateway_tools');
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_runs'::regclass
                        AND conname = 'agent_runs_h5_agent_allowlist') THEN 'agent_runs_h5_agent_allowlist' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_planning_runs'::regclass
                        AND conname IN ('agent_planning_runs_intent_allowlist', 'agent_planning_runs_resource_type_allowlist',
                                        'agent_planning_runs_plan_outcome_allowlist', 'agent_planning_runs_record_shape_v2'))
         THEN 'agent_planning_runs H5 checks' END,
    CASE WHEN to_regclass('public.agent_planning_events') IS NOT NULL THEN 'agent_planning_events' END,
    CASE WHEN to_regclass('public.agent_proposal_handoffs') IS NOT NULL THEN 'agent_proposal_handoffs' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc procs JOIN pg_namespace namespaces ON namespaces.oid = procs.pronamespace
                       WHERE namespaces.nspname = 'public' AND procs.proname IN (
                         'agent__planning_intent_spec', 'agent__planning_event', 'agent__handoff_json',
                         'agent_planning_record_context', 'agent_proposal_handoff_admit', 'agent_proposal_handoff_get',
                         'agent_proposal_handoffs_for_run', 'agent_proposal_handoff_cancel', 'agent_planning_dismiss',
                         'agent_planning_events_page', 'agent_tool_execute_room_assignment'))
         THEN 'H5 functions' END,
    CASE WHEN public.agent__gateway_tool_spec('housekeeping.room_readiness_assistant', 1, 'housekeeping.rooms.status_lookup', 1) IS NOT NULL
           OR public.agent__gateway_tool_spec('engineering.dispatch_assistant', 2, 'engineering.work_orders.lookup', 2) IS NOT NULL
         THEN 'H5 gateway allowlist' END], NULL) INTO h5_present;

  IF h5_recorded = 0 THEN
    -- H4 schema (history ends at or before 250).
    IF cardinality(h5_present) > 0 THEN
      RAISE EXCEPTION 'H5 objects exist without their recorded migrations: %', h5_present;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_runs'::regclass
                     AND conname = 'agent_runs_h3_agent_allowlist' AND convalidated) THEN
      RAISE EXCEPTION 'agent_runs_h3_agent_allowlist is missing';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.agent_planning_runs'::regclass AND contype = 'c'
          AND convalidated AND conname IN ('agent_planning_runs_intent_check', 'agent_planning_runs_resource_type_check',
                                           'agent_planning_runs_plan_outcome_check', 'agent_planning_runs_record_shape')) <> 4 THEN
      RAISE EXCEPTION 'The H3 agent_planning_runs checks are missing';
    END IF;
  ELSIF h5_recorded = 3 THEN
    -- Complete H5 schema.
    IF cardinality(h5_present) <> 6 THEN
      RAISE EXCEPTION 'H5 migrations are recorded but H5 objects are missing (present: %)', h5_present;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_runs'::regclass
                 AND conname = 'agent_runs_h3_agent_allowlist')
       OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_planning_runs'::regclass
                    AND conname IN ('agent_planning_runs_intent_check', 'agent_planning_runs_resource_type_check',
                                    'agent_planning_runs_plan_outcome_check', 'agent_planning_runs_record_shape')) THEN
      RAISE EXCEPTION 'An H3 check that migration 251 replaces still exists';
    END IF;
    -- Agent allowlist: exactly the five reviewed (agent, version) pairs, validated.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint constraints, LATERAL pg_get_constraintdef(constraints.oid) AS definition(src)
      WHERE constraints.conrelid = 'public.agent_runs'::regclass AND constraints.conname = 'agent_runs_h5_agent_allowlist'
        AND constraints.contype = 'c' AND constraints.convalidated
        AND (length(definition.src) - length(replace(definition.src, 'agent_id = ', ''))) / length('agent_id = ') = 5
        AND definition.src LIKE '%(agent_id = ''harness.synthetic''::text) AND (agent_version = 1))%'
        AND definition.src LIKE '%(agent_id = ''engineering.dispatch_assistant''::text) AND (agent_version = 1) AND (synthetic_spec = ''{}''::jsonb)%'
        AND definition.src LIKE '%(agent_id = ''harness.orchestrator''::text) AND (agent_version = 1) AND (synthetic_spec = ''{}''::jsonb)%'
        AND definition.src LIKE '%(agent_id = ''engineering.dispatch_assistant''::text) AND (agent_version = 2) AND (synthetic_spec = ''{}''::jsonb)%'
        AND definition.src LIKE '%(agent_id = ''housekeeping.room_readiness_assistant''::text) AND (agent_version = 1) AND (synthetic_spec = ''{}''::jsonb)%'
    ) THEN
      RAISE EXCEPTION 'agent_runs_h5_agent_allowlist is missing, unvalidated or not exactly the reviewed five agents';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.agent_planning_runs'::regclass AND contype = 'c'
          AND convalidated AND conname IN ('agent_planning_runs_intent_allowlist', 'agent_planning_runs_resource_type_allowlist',
                                           'agent_planning_runs_plan_outcome_allowlist', 'agent_planning_runs_record_shape_v2',
                                           'agent_planning_runs_intent_version_check')) <> 5 THEN
      RAISE EXCEPTION 'The H5 agent_planning_runs checks are missing or unvalidated';
    END IF;
    -- Planning events and proposal handoffs: RLS on with no policy, closed to end users, and append-only through an
    -- enabled BEFORE UPDATE OR DELETE row trigger (the backend's table rights come from platform default privileges,
    -- exactly as for every earlier agent table).
    IF EXISTS (
      SELECT 1 FROM pg_class relations
      WHERE relations.oid IN ('public.agent_planning_events'::regclass, 'public.agent_proposal_handoffs'::regclass)
        AND (NOT relations.relrowsecurity
             OR EXISTS (SELECT 1 FROM pg_policy policies WHERE policies.polrelid = relations.oid)
             OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) AS end_users(role_name)
                         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                           AS privileges(name)
                         WHERE has_table_privilege(end_users.role_name, relations.oid, privileges.name)))
    ) OR (SELECT count(*) FROM pg_trigger
           WHERE tgenabled = 'O' AND tgfoid = 'public.agent__guard_tool_immutable()'::regprocedure
             AND (tgtype & 27) = 27  -- ROW (1) + BEFORE (2) + DELETE (8) + UPDATE (16)
             AND (tgrelid, tgname) IN (
               ('public.agent_planning_events'::regclass, 'agent_planning_events_immutable'),
               ('public.agent_proposal_handoffs'::regclass, 'agent_proposal_handoffs_immutable'))) <> 2 THEN
      RAISE EXCEPTION 'An H5 planning-event or handoff table is exposed, has a policy, is mutable, or lost RLS';
    END IF;
    -- Every H5 function: SECURITY INVOKER, empty search_path, callable by the backend only (no PUBLIC grant).
    IF (SELECT count(*) FROM pg_proc procs
         WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname IN (
           'agent__planning_intent_spec', 'agent__planning_event', 'agent__handoff_json', 'agent_planning_record_context',
           'agent_proposal_handoff_admit', 'agent_proposal_handoff_get', 'agent_proposal_handoffs_for_run',
           'agent_proposal_handoff_cancel', 'agent_planning_dismiss', 'agent_planning_events_page',
           'agent_tool_execute_room_assignment', 'agent__gateway_tool_spec', 'agent__planning_intent_roles',
           'agent_planning_run_admit', 'agent_planning_record_plan')
           AND NOT procs.prosecdef AND procs.proconfig = ARRAY['search_path=""']
           AND has_function_privilege('service_role', procs.oid, 'EXECUTE')
           AND procs.proacl IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM aclexplode(procs.proacl) AS acl WHERE acl.grantee = 0)) <> 15 THEN
      RAISE EXCEPTION 'An H5 function is missing, overloaded, SECURITY DEFINER, has a search_path, or is granted to PUBLIC';
    END IF;
    -- Gateway allowlist: across every agent/tool/version combination, EXACTLY the ten reviewed pins resolve, so no agent
    -- reaches another department's tools; the two writes keep their reviewed risk and roles.
    SELECT count(*) INTO h5_unexpected
      FROM unnest(ARRAY['harness.synthetic', 'harness.orchestrator', 'engineering.dispatch_assistant',
                        'housekeeping.room_readiness_assistant']) AS agents(id)
      CROSS JOIN generate_series(1, 3) AS agent_versions(v)
      CROSS JOIN unnest(ARRAY['engineering.work_orders.lookup', 'engineering.work_orders.assignment_candidates',
                              'engineering.work_orders.assign', 'housekeeping.rooms.status_lookup',
                              'housekeeping.rooms.readiness_lookup', 'housekeeping.room_assignments.candidates',
                              'housekeeping.room_assignments.assign']) AS tools(id)
      CROSS JOIN generate_series(1, 3) AS tool_versions(v)
     WHERE (public.agent__gateway_tool_spec(agents.id, agent_versions.v, tools.id, tool_versions.v) IS NOT NULL)
           <> ((agents.id, agent_versions.v, tools.id, tool_versions.v) IN (
                ('engineering.dispatch_assistant', 1, 'engineering.work_orders.lookup', 2),
                ('engineering.dispatch_assistant', 1, 'housekeeping.rooms.status_lookup', 1),
                ('engineering.dispatch_assistant', 1, 'engineering.work_orders.assign', 2),
                ('engineering.dispatch_assistant', 2, 'engineering.work_orders.lookup', 2),
                ('engineering.dispatch_assistant', 2, 'engineering.work_orders.assignment_candidates', 1),
                ('engineering.dispatch_assistant', 2, 'engineering.work_orders.assign', 2),
                ('housekeeping.room_readiness_assistant', 1, 'housekeeping.rooms.status_lookup', 1),
                ('housekeeping.room_readiness_assistant', 1, 'housekeeping.rooms.readiness_lookup', 1),
                ('housekeeping.room_readiness_assistant', 1, 'housekeeping.room_assignments.candidates', 1),
                ('housekeeping.room_readiness_assistant', 1, 'housekeeping.room_assignments.assign', 1)));
    IF h5_unexpected <> 0
       OR public.agent__gateway_tool_spec('engineering.dispatch_assistant', 1, 'engineering.work_orders.assign', 2)
            IS DISTINCT FROM '{"access": "write", "risk": "medium", "resource_type": "work_order", "roles": ["chief_engineer", "gm"]}'::jsonb
       OR public.agent__gateway_tool_spec('engineering.dispatch_assistant', 2, 'engineering.work_orders.assign', 2)
            IS DISTINCT FROM '{"access": "write", "risk": "medium", "resource_type": "work_order", "roles": ["chief_engineer", "gm"]}'::jsonb
       OR public.agent__gateway_tool_spec('housekeeping.room_readiness_assistant', 1, 'housekeeping.room_assignments.assign', 1)
            IS DISTINCT FROM '{"access": "write", "risk": "high", "resource_type": "room", "roles": ["gm", "housekeeping_supervisor"]}'::jsonb THEN
      RAISE EXCEPTION 'The H5 gateway allowlist crosses departments, widened, or lost the reviewed write classification';
    END IF;
    -- Intent catalog: each specialist intent stays inside its department, and only the two recommendation intents may
    -- propose a write (their own department's).
    IF public.agent__planning_intent_roles('engineering.work_order_dispatch_plan', 1) IS DISTINCT FROM ARRAY['chief_engineer', 'gm']
       OR public.agent__planning_intent_roles('engineering.work_order_triage', 1) IS DISTINCT FROM ARRAY['chief_engineer', 'engineer', 'gm']
       OR public.agent__planning_intent_roles('engineering.work_order_dispatch_recommendation', 1) IS DISTINCT FROM ARRAY['chief_engineer', 'gm']
       OR public.agent__planning_intent_roles('housekeeping.room_readiness_review', 1) IS DISTINCT FROM ARRAY['gm', 'housekeeping_supervisor']
       OR public.agent__planning_intent_roles('housekeeping.room_assignment_recommendation', 1) IS DISTINCT FROM ARRAY['gm', 'housekeeping_supervisor']
       OR public.agent__planning_intent_spec('engineering.work_order_dispatch_recommendation', 1)->'write'
            IS DISTINCT FROM '{"tool_id": "engineering.work_orders.assign", "tool_version": 2}'::jsonb
       OR public.agent__planning_intent_spec('housekeeping.room_assignment_recommendation', 1)->'write'
            IS DISTINCT FROM '{"tool_id": "housekeeping.room_assignments.assign", "tool_version": 1}'::jsonb
       OR public.agent__planning_intent_spec('housekeeping.room_readiness_review', 1)->'write' IS DISTINCT FROM 'null'::jsonb
       OR public.agent__planning_intent_spec('engineering.work_order_triage', 1)->'write' IS DISTINCT FROM 'null'::jsonb
       OR public.agent__planning_intent_spec('engineering.work_order_dispatch_plan', 1)->'write' IS DISTINCT FROM 'null'::jsonb
       OR public.agent__planning_intent_spec('housekeeping.room_assignment_recommendation', 1)->'specialist'->>'agent_id'
            IS DISTINCT FROM 'housekeeping.room_readiness_assistant'
       OR public.agent__planning_intent_spec('engineering.work_order_dispatch_recommendation', 1)->'specialist'->>'agent_id'
            IS DISTINCT FROM 'engineering.dispatch_assistant'
       OR public.agent__planning_intent_roles('housekeeping.room_assignment_recommendation', 2) IS NOT NULL
       OR public.agent__planning_intent_spec('housekeeping.room_assignment_recommendation', 2) IS NOT NULL THEN
      RAISE EXCEPTION 'The H5 planning intent catalog crosses departments or proposes an unreviewed write';
    END IF;
  ELSE
    RAISE EXCEPTION 'H5 migrations 251-253 are partially applied (% of 3 recorded); the schema version is not trusted', h5_recorded;
  END IF;

  -- H6 (255 worker identity, 256 Control Center) extends the 254 registry by two tables (one append-only).
  SELECT count(DISTINCT history.name) INTO h6_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name IN ('agent_worker_database_identity', 'agent_control_center');
  IF h6_recorded = 2 THEN
    protected_tables := 33;
    append_only_tables := 12;
  END IF;
  -- H6 P1 (261) adds the credential scopes and the deployment identity, both append-only.
  SELECT count(DISTINCT history.name) INTO p1_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'agent_worker_tenant_binding';
  IF p1_recorded = 1 AND h6_recorded = 2 THEN
    protected_tables := 35;
    append_only_tables := 14;
  END IF;

  -- Pre-H6 hardening (migration 254: append-only audit integrity #230, independent approval #231). Version-gated by
  -- migration NAME exactly like H5: staging receives 254 through a reviewed preview before it merges.
  --   not recorded -> no hardening object may exist;  recorded -> the complete hardening is enforced below.
  SELECT count(DISTINCT history.name) INTO hardening_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'agent_audit_integrity_and_independent_approval';
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname IN (
           'agent__audit_protected_tables', 'agent__refuse_truncate', 'agent_audit_privilege_violations',
           'agent_audit_privileges_enforce', 'agent__guard_approval_independence', 'agent__guard_execution_approval'))
         THEN 'hardening functions' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
           'agent_refuse_truncate', 'agent_tool_approvals_independence', 'agent_tool_executions_approval_guard'))
         THEN 'hardening triggers' END], NULL) INTO hardening_present;
  IF hardening_recorded = 0 THEN
    IF cardinality(hardening_present) > 0 THEN
      RAISE EXCEPTION 'Agent hardening objects exist without migration 254 recorded: %', hardening_present;
    END IF;
  ELSE
    IF h5_recorded <> 3 THEN
      RAISE EXCEPTION 'Migration 254 is recorded on a schema without the complete H5 migrations';
    END IF;
    -- Six functions: SECURITY INVOKER, empty search_path, owner-only (never callable by end users, PUBLIC or
    -- service_role; 254 revokes all four, and this contract runs before CI's blanket function grant).
    IF (SELECT count(*) FROM pg_proc procs
         WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname IN (
           'agent__audit_protected_tables', 'agent__refuse_truncate', 'agent_audit_privilege_violations',
           'agent_audit_privileges_enforce', 'agent__guard_approval_independence', 'agent__guard_execution_approval')
           AND NOT procs.prosecdef AND procs.proconfig = ARRAY['search_path=""'] AND procs.proacl IS NOT NULL
           AND NOT has_function_privilege('anon', procs.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', procs.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', procs.oid, 'EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM aclexplode(procs.proacl) AS acl WHERE acl.grantee = 0)) <> 6 THEN
      RAISE EXCEPTION 'A hardening function is missing, overloaded, SECURITY DEFINER, has a search_path, or is exposed';
    END IF;
    -- The registry is exactly every harness table (31 / 11 append-only; 33 / 12 once H6 is recorded; 35 / 14 once
    -- 261 is recorded) and names only
    -- existing tables.
    IF (SELECT count(*) FROM public.agent__audit_protected_tables()) <> protected_tables
       OR (SELECT count(*) FROM public.agent__audit_protected_tables() WHERE append_only) <> append_only_tables
       OR EXISTS (SELECT 1 FROM public.agent__audit_protected_tables() registry
                   WHERE to_regclass(format('public.%I', registry.table_name)) IS NULL)
       OR EXISTS (SELECT 1 FROM pg_class relations
                   WHERE relations.relnamespace = 'public'::regnamespace AND relations.relkind IN ('r', 'p')
                     AND relations.relname ~ '^(agent_|billing_trueup_)'
                     AND relations.relname NOT IN (SELECT registry.table_name FROM public.agent__audit_protected_tables() registry)) THEN
      RAISE EXCEPTION 'The protected agent table registry does not cover exactly the harness tables';
    END IF;
    -- Privilege-independent controls: one enabled statement-level BEFORE TRUNCATE refusal on every registered table
    -- (tgtype 34 = BEFORE 2 + TRUNCATE 32, no ROW bit); an enabled BEFORE UPDATE OR DELETE row guard on every
    -- append-only table; the two approval-independence guards.
    IF (SELECT count(*) FROM public.agent__audit_protected_tables() registry
          JOIN pg_trigger triggers ON triggers.tgrelid = format('public.%I', registry.table_name)::regclass
         WHERE triggers.tgname = 'agent_refuse_truncate' AND triggers.tgenabled = 'O' AND triggers.tgtype = 34
           AND triggers.tgfoid = 'public.agent__refuse_truncate()'::regprocedure) <> protected_tables
       OR (SELECT count(DISTINCT registry.table_name) FROM public.agent__audit_protected_tables() registry
             JOIN pg_trigger triggers ON triggers.tgrelid = format('public.%I', registry.table_name)::regclass
            WHERE registry.append_only AND triggers.tgenabled = 'O' AND NOT triggers.tgisinternal
              AND (triggers.tgtype & 27) = 27) <> append_only_tables
       OR NOT EXISTS (SELECT 1 FROM pg_trigger triggers
                       WHERE triggers.tgrelid = 'public.agent_tool_approvals'::regclass
                         AND triggers.tgname = 'agent_tool_approvals_independence' AND triggers.tgenabled = 'O'
                         AND triggers.tgtype = 23  -- ROW 1 + BEFORE 2 + INSERT 4 + UPDATE 16
                         AND triggers.tgfoid = 'public.agent__guard_approval_independence()'::regprocedure)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger triggers
                       WHERE triggers.tgrelid = 'public.agent_tool_executions'::regclass
                         AND triggers.tgname = 'agent_tool_executions_approval_guard' AND triggers.tgenabled = 'O'
                         AND triggers.tgtype = 7  -- ROW 1 + BEFORE 2 + INSERT 4
                         AND triggers.tgfoid = 'public.agent__guard_execution_approval()'::regprocedure)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger triggers
                       WHERE triggers.tgrelid = 'public.agent_tool_approvals'::regclass
                         AND triggers.tgname = 'agent_tool_approvals_guard_update' AND triggers.tgenabled = 'O') THEN
      RAISE EXCEPTION 'An agent audit-integrity or approval-independence trigger is missing, disabled or altered';
    END IF;
    -- Least privilege. Every workflow that grants blanket table rights re-runs agent_audit_privileges_enforce() in the
    -- same transaction, so no protected right may be present here.
    IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations()) THEN
      RAISE EXCEPTION 'A role holds TRUNCATE on an agent table, or UPDATE/DELETE on an append-only agent table: %',
        (SELECT string_agg(format('%s:%s:%s', v.table_name, v.role_name, v.privilege), ', ')
           FROM public.agent_audit_privilege_violations() v);
    END IF;
    -- Approver independence cannot be granted to any reviewed write: none is low risk.
    IF EXISTS (SELECT 1
                 FROM unnest(ARRAY['engineering.dispatch_assistant', 'housekeeping.room_readiness_assistant']) AS agents(id)
                CROSS JOIN generate_series(1, 3) AS agent_versions(v)
                CROSS JOIN unnest(ARRAY['engineering.work_orders.assign', 'housekeeping.room_assignments.assign']) AS tools(id)
                CROSS JOIN generate_series(1, 3) AS tool_versions(v)
                WHERE public.agent__gateway_tool_spec(agents.id, agent_versions.v, tools.id, tool_versions.v)->>'access' = 'write'
                  AND public.agent__gateway_tool_spec(agents.id, agent_versions.v, tools.id, tool_versions.v)->>'risk'
                      IS DISTINCT FROM 'medium'
                  AND public.agent__gateway_tool_spec(agents.id, agent_versions.v, tools.id, tool_versions.v)->>'risk'
                      IS DISTINCT FROM 'high') THEN
      RAISE EXCEPTION 'A reviewed gateway write is no longer medium or high risk';
    END IF;
  END IF;
  -- H6 (migrations 255 + 256). Version-gated by migration NAME like H5 and 254: staging receives them only through a
  -- reviewed preview.  not recorded -> no H6 object may exist;  both recorded -> the complete contract below.
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
                       AND (procs.proname LIKE 'agent\_worker\_rpc\_\_%' OR procs.proname LIKE 'agent\_control\_center\_%'))
         THEN 'H6 functions' END,
    CASE WHEN to_regclass('public.agent_worker_credentials') IS NOT NULL
           OR to_regclass('public.agent_control_center_events') IS NOT NULL THEN 'H6 tables' END,
    -- Every other 255/256 object, by exact name: the role (cluster-wide, so it survives a database-only restore),
    -- the helpers the two patterns above do not match, and the H6 triggers.
    CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_worker') THEN 'H6 role agent_worker' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname IN (
           'agent__worker_credential_ok', 'agent__worker_assert', 'agent__guard_worker_credential',
           'agent_worker_credential_register', 'agent_worker_credential_revoke', 'agent_worker_credentials_list',
           'agent__worker_allowed_rpcs', 'agent__worker_read_columns', 'agent_worker_privilege_violations',
           'agent_runtime_controls_snapshot', 'agent__guard_control_center_event', 'agent__control_center_journal',
           'agent__journal_control_change', 'agent__control_center_run_json', 'agent__try_uuid'))
         THEN 'H6 helper functions' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN (
           'agent_control_center_journal', 'agent_control_center_events_immutable', 'agent_worker_credentials_guard'))
         THEN 'H6 triggers' END], NULL) INTO h6_present;
  IF h6_recorded = 0 THEN
    IF cardinality(h6_present) > 0 THEN
      RAISE EXCEPTION 'Agent H6 objects exist without migrations 255/256 recorded: %', h6_present;
    END IF;
  ELSIF h6_recorded <> 2 OR hardening_recorded = 0 THEN
    RAISE EXCEPTION 'H6 migrations 255/256 are partially applied or recorded without 254; the schema version is not trusted';
  ELSE
    -- The worker identity: exact attributes, no memberships, nothing beyond the reviewed wrappers and columns.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_worker' AND NOT rolcanlogin AND NOT rolinherit
                    AND NOT rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb)
       OR NOT pg_has_role('authenticator', 'agent_worker', 'MEMBER')
       OR EXISTS (SELECT 1 FROM public.agent_worker_privilege_violations()) THEN
      RAISE EXCEPTION 'The agent_worker identity exceeds its reviewed privileges: %',
        (SELECT string_agg(v.object_name || ':' || v.violation, ', ') FROM public.agent_worker_privilege_violations() v);
    END IF;
    -- Exactly 23 wrappers and 5 other definers, counted over every overload, each SECURITY DEFINER with an empty
    -- search_path: an overload under a reviewed name is never exempt.
    IF (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
          AND procs.proname LIKE 'agent\_worker\_rpc\_\_%' AND procs.prosecdef
          AND procs.proconfig = ARRAY['search_path=""']) <> 23
       OR (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
             AND procs.proname LIKE 'agent\_worker\_rpc\_\_%') <> 23
       OR (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
             AND procs.proname IN ('agent__worker_credential_ok', 'agent__worker_assert', 'agent__control_center_journal',
                                   'agent__journal_control_change', 'agent_control_center_record_refusal')) <> 5
       OR (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
             AND procs.proname IN ('agent__worker_credential_ok', 'agent__worker_assert', 'agent__control_center_journal',
                                   'agent__journal_control_change', 'agent_control_center_record_refusal')
             AND procs.prosecdef AND procs.proconfig = ARRAY['search_path=""']) <> 5 THEN
      RAISE EXCEPTION 'The reviewed H6 SECURITY DEFINER set (23 wrappers, 5 helpers) is missing, extended, overloaded or not pinned';
    END IF;
    -- Every control table journals its changes in the same transaction; the journal is immutable.
    IF (SELECT count(*) FROM pg_trigger triggers
         WHERE triggers.tgname = 'agent_control_center_journal' AND triggers.tgenabled = 'O'
           AND triggers.tgrelid IN ('public.agent_runtime_controls'::regclass, 'public.agent_tool_grants'::regclass,
                                    'public.agent_execution_enablement'::regclass, 'public.agent_model_enablement'::regclass,
                                    'public.agent_tool_controls'::regclass, 'public.agent_customer_billing_controls'::regclass,
                                    'public.agent_worker_credentials'::regclass)) <> 7
       OR NOT EXISTS (SELECT 1 FROM pg_trigger triggers WHERE triggers.tgname = 'agent_control_center_events_immutable'
                       AND triggers.tgrelid = 'public.agent_control_center_events'::regclass AND triggers.tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger triggers WHERE triggers.tgname = 'agent_worker_credentials_guard'
                       AND triggers.tgrelid = 'public.agent_worker_credentials'::regclass AND triggers.tgenabled = 'O') THEN
      RAISE EXCEPTION 'An H6 journal or credential guard trigger is missing or disabled';
    END IF;
    -- Read models and controls: service_role only; never end users.
    IF EXISTS (SELECT 1 FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
                 AND procs.proname LIKE 'agent\_control\_center\_%'
                 AND (has_function_privilege('anon', procs.oid, 'EXECUTE')
                      OR has_function_privilege('authenticated', procs.oid, 'EXECUTE')
                      OR has_function_privilege('agent_worker', procs.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'An AI Control Center function is executable by an end-user or worker role';
    END IF;
  END IF;

  -- Legacy hosted default: PUBLIC holds CREATE on schema public (pre-PG15). Version-gated by migration NAME, like
  -- H5/254/H6: schemas 254 and 256 as deployed still carry the grant and stay compatible until the fix is recorded.
  --   not recorded -> tolerated;  recorded -> only the schema owner (and superusers) may create in public.
  SELECT count(DISTINCT history.name) INTO public_create_fixed FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'public_schema_create_revoked';
  IF public_create_fixed > 0 THEN
    IF EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') THEN
      RAISE EXCEPTION 'PUBLIC holds CREATE on schema public although migration public_schema_create_revoked is recorded';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r
                WHERE r.rolname !~ '^pg_' AND NOT r.rolsuper
                  AND NOT pg_has_role(r.oid, (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER')
                  AND has_schema_privilege(r.oid, 'public', 'CREATE')) THEN
      RAISE EXCEPTION 'A role other than the schema owner holds CREATE on schema public: %',
        (SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) FROM pg_roles r
          WHERE r.rolname !~ '^pg_' AND NOT r.rolsuper
            AND NOT pg_has_role(r.oid, (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER')
            AND has_schema_privilege(r.oid, 'public', 'CREATE'));
    END IF;
    IF NOT has_schema_privilege('anon', 'public', 'USAGE') OR NOT has_schema_privilege('authenticated', 'public', 'USAGE')
       OR NOT has_schema_privilege('service_role', 'public', 'USAGE') THEN
      RAISE EXCEPTION 'An API role lost USAGE on schema public';
    END IF;
  END IF;

  -- Exact backend privilege matrix on the protected harness tables, and no TRIGGER/REFERENCES/MAINTAIN for application
  -- roles on any relation in public (migration 258). Version-gated by migration NAME.
  -- Computed here independently of agent_audit_privilege_violations(), so a weakened function body is still caught.
  --   not recorded -> tolerated (254-257 enumerate a subset);  recorded -> exact matrix, nothing for anyone else.
  SELECT count(DISTINCT history.name) INTO exact_privileges_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'agent_audit_exact_backend_privileges';
  -- Migration 259 (agent_control_delete_guard) removes the tolerated DELETE and replaces the detector body.
  SELECT count(DISTINCT history.name) INTO delete_guard_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'agent_control_delete_guard';
  IF exact_privileges_recorded > 0 THEN
    IF hardening_recorded = 0 OR h6_recorded <> 2 THEN
      RAISE EXCEPTION 'Migration 258 is recorded on a schema without migrations 254-256';
    END IF;
    -- The detector and the remover are pinned to their reviewed 258 bodies, so a weakened function cannot pass this gate
    -- by reporting nothing (the matrix below is also recomputed without them).
    IF (SELECT count(*) FROM pg_proc procs
         WHERE procs.pronamespace = 'public'::regnamespace AND NOT procs.prosecdef
           AND procs.proconfig = ARRAY['search_path=""']
           AND (procs.proname, md5(replace(procs.prosrc, chr(13), ''))) IN (
                 ('agent_audit_privilege_violations', CASE WHEN p1_recorded > 0
                                                        THEN '2dfcdf8e75aaceb2c2ae479d3d70bcae'   -- 261 body
                                                        WHEN delete_guard_recorded > 0
                                                        THEN '9b368df4cb0eb890ebaa7f7e58d3f582'   -- 259 body
                                                        ELSE 'e03f461a4923252de8996af8fdfbf39f' END),
                 ('agent_audit_privileges_enforce', CASE WHEN p1_recorded > 0
                                                      THEN 'd0f41069966294caac73007797c4706b'     -- 261 body
                                                      ELSE '37248313075777a945bad80155845f7d' END))) <> 2 THEN
      RAISE EXCEPTION 'agent_audit_privilege_violations() or agent_audit_privileges_enforce() differs from its reviewed migration-258/259/261 body';
    END IF;
    SELECT string_agg(format('%s:%s:%s', drift.table_name, drift.role_name, drift.privilege), ', '
                      ORDER BY drift.table_name, drift.role_name, drift.privilege) INTO exact_privilege_drift
      FROM (
        SELECT registry.table_name, grantees.role_name, rights.privilege_type AS privilege
          FROM public.agent__audit_protected_tables() registry
         CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS grantees(role_name)
         CROSS JOIN (SELECT DISTINCT acl.privilege_type FROM aclexplode(acldefault('r', 10::oid)) acl) rights
         WHERE (has_table_privilege(grantees.role_name, format('public.%I', registry.table_name), rights.privilege_type)
                OR (rights.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                    AND has_any_column_privilege(grantees.role_name, format('public.%I', registry.table_name), rights.privilege_type)))
           AND NOT (grantees.role_name = 'service_role' AND rights.privilege_type = ANY (CASE
                      -- the H6 journal and (261) the deployment identity: SELECT only
                      WHEN registry.table_name IN ('agent_control_center_events', 'agent_deployment_identity')
                        THEN ARRAY['SELECT']
                      WHEN registry.append_only THEN ARRAY['SELECT', 'INSERT']
                      WHEN delete_guard_recorded > 0 THEN ARRAY['SELECT', 'INSERT', 'UPDATE']
                      ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] END))
        UNION ALL
        SELECT relations.relname::text, grantees.role_name, rights.privilege_type
          FROM pg_class relations
         CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS grantees(role_name)
         CROSS JOIN (SELECT DISTINCT acl.privilege_type FROM aclexplode(acldefault('r', 10::oid)) acl
                      WHERE acl.privilege_type IN ('TRIGGER', 'REFERENCES', 'MAINTAIN')) rights
         WHERE relations.relnamespace = 'public'::regnamespace AND relations.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND relations.relname NOT IN (SELECT registry.table_name FROM public.agent__audit_protected_tables() registry)
           AND (has_table_privilege(grantees.role_name, relations.oid, rights.privilege_type)
                OR (rights.privilege_type = 'REFERENCES'
                    AND has_any_column_privilege(grantees.role_name, relations.oid, rights.privilege_type)))
        UNION ALL
        -- MINIMUM: the rights each table's creating migration granted to service_role, listed per table (not derived from
        -- append_only: agent_model_price_schedules is registered mutable but 244 granted it SELECT, INSERT only). The
        -- maximum above still tolerates UPDATE/DELETE on every mutable-registered table. A registry table missing from this
        -- list, or a listed table missing from the registry, is drift too.
        SELECT coalesce(registry.table_name, minimum.table_name), 'service_role (missing)',
               CASE WHEN registry.table_name IS NULL THEN 'not registered' ELSE wanted.privilege END
          FROM public.agent__audit_protected_tables() registry
          FULL JOIN (SELECT listed.table_name, listed.rights FROM (VALUES
                 ('agent_runs', 'SIU'), ('agent_run_steps', 'SIU'), ('agent_run_events', 'SI'),
                 ('agent_runtime_controls', 'SIU'), ('agent_worker_heartbeats', 'SIU'),
                 ('agent_execution_enablement', 'SIU'), ('agent_tool_controls', 'SIU'), ('agent_tool_grants', 'SIU'),
                 ('agent_tool_approvals', 'SIU'), ('agent_tool_invocations', 'SI'), ('agent_tool_executions', 'SI'),
                 ('agent_tool_events', 'SI'),
                 ('agent_model_enablement', 'SIU'), ('agent_model_budget_policies', 'SIU'),
                 ('agent_model_budget_counters', 'SIU'), ('agent_model_attempts', 'SIU'),
                 ('agent_model_price_schedules', 'SI'), ('agent_model_spend_events', 'SI'), ('agent_planning_runs', 'SIU'),
                 ('agent_customer_billing_controls', 'SIU'), ('agent_customer_pricing_policies', 'SIU'),
                 ('agent_customer_credit_holds', 'SIU'), ('agent_customer_credit_charges', 'SIU'),
                 ('agent_billing_operations', 'SIU'), ('agent_customer_overage_authorizations', 'SI'),
                 ('agent_customer_billing_events', 'SI'), ('agent_billing_operation_events', 'SI'),
                 ('billing_trueup_operations', 'SIU'), ('billing_trueup_operation_events', 'SI'),
                 ('agent_planning_events', 'SI'), ('agent_proposal_handoffs', 'SI'),
                 ('agent_worker_credentials', 'SIU'), ('agent_control_center_events', 'S'),
                 -- 261 (H6 P1): listed only once 261 is recorded
                 ('agent_worker_credential_scopes', 'SI'), ('agent_deployment_identity', 'S')
               ) AS listed(table_name, rights)
               WHERE p1_recorded > 0
                  OR listed.table_name NOT IN ('agent_worker_credential_scopes', 'agent_deployment_identity')
               ) AS minimum(table_name, rights) ON minimum.table_name = registry.table_name
          LEFT JOIN LATERAL unnest(CASE WHEN minimum.rights IS NULL THEN ARRAY['unlisted'] ELSE
                 array_remove(ARRAY[CASE WHEN strpos(minimum.rights, 'S') > 0 THEN 'SELECT' END,
                                    CASE WHEN strpos(minimum.rights, 'I') > 0 THEN 'INSERT' END,
                                    CASE WHEN strpos(minimum.rights, 'U') > 0 THEN 'UPDATE' END], NULL) END)
                 AS wanted(privilege) ON true
         WHERE CASE WHEN registry.table_name IS NULL OR minimum.table_name IS NULL THEN true
                    ELSE NOT has_table_privilege('service_role', format('public.%I', registry.table_name), wanted.privilege) END
      ) drift;
    IF exact_privilege_drift IS NOT NULL THEN
      RAISE EXCEPTION 'Protected agent table privileges differ from the reviewed matrix: %', exact_privilege_drift;
    END IF;
  END IF;

  -- No DELETE of agent safety controls, grants or approvals (migration 259). Version-gated by migration NAME.
  --   recorded -> the guard function is pinned, the BEFORE DELETE row guard is on exactly the 7 reviewed tables, and no
  --   application role holds DELETE on any registered table (the maximum above no longer tolerates it).
  IF delete_guard_recorded > 0 THEN
    IF exact_privileges_recorded = 0 THEN
      RAISE EXCEPTION 'Migration 259 is recorded on a schema without migration 258';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc procs
                    WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__guard_control_delete'
                      AND NOT procs.prosecdef AND procs.proowner = 'postgres'::regrole
                      AND procs.proconfig = ARRAY['search_path=""']
                      AND md5(replace(procs.prosrc, chr(13), '')) = '203d70028c0e96f7463b1fe327a17e5a'
                      AND NOT has_function_privilege('public', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('anon', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('agent_worker', procs.oid, 'EXECUTE')) THEN
      -- service_role EXECUTE is tolerated: the CI fixture grants EXECUTE on all functions, and a trigger function cannot
      -- be called directly ("trigger functions can only be called as triggers").
      RAISE EXCEPTION 'agent__guard_control_delete() differs from its reviewed migration-259 body or ACL';
    END IF;
    SELECT string_agg(coalesce(wanted.table_name, found.table_name), ', ') INTO delete_guard_drift
      FROM (VALUES ('agent_runtime_controls'), ('agent_tool_controls'), ('agent_execution_enablement'),
                   ('agent_model_enablement'), ('agent_customer_billing_controls'), ('agent_tool_grants'),
                   ('agent_tool_approvals')) AS wanted(table_name)
      FULL JOIN (SELECT triggers.tgrelid::regclass::text AS qualified, relations.relname::text AS table_name
                   FROM pg_trigger triggers JOIN pg_class relations ON relations.oid = triggers.tgrelid
                  WHERE triggers.tgfoid = 'public.agent__guard_control_delete()'::regprocedure
                    AND triggers.tgname = 'agent_control_delete_guard' AND triggers.tgenabled = 'O'
                    AND triggers.tgtype = 11  -- exactly ROW (1) + BEFORE (2) + DELETE (8): not AFTER, not statement-level
                    AND NOT triggers.tgisinternal AND triggers.tgconstraint = 0  -- a plain trigger, not a constraint trigger
                    AND triggers.tgqual IS NULL AND triggers.tgnargs = 0      -- no WHEN clause, no arguments
                    AND triggers.tgattr = ''::int2vector                       -- no column list
                    AND relations.relnamespace = 'public'::regnamespace) found ON found.table_name = wanted.table_name
     WHERE wanted.table_name IS NULL OR found.table_name IS NULL;
    IF delete_guard_drift IS NOT NULL
       OR (SELECT count(*) FROM pg_trigger triggers
            WHERE triggers.tgfoid = 'public.agent__guard_control_delete()'::regprocedure) <> 7
       OR (SELECT count(*) FROM pg_trigger triggers WHERE triggers.tgname = 'agent_control_delete_guard') <> 7 THEN
      RAISE EXCEPTION 'The migration-259 DELETE guard is missing, disabled or misplaced: %', coalesce(delete_guard_drift, 'trigger count');
    END IF;
    SELECT string_agg(format('%s:%s', registry.table_name, grantees.role_name), ', ') INTO delete_guard_drift
      FROM public.agent__audit_protected_tables() registry
     CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) AS grantees(role_name)
     WHERE has_table_privilege(grantees.role_name, format('public.%I', registry.table_name), 'DELETE');
    IF delete_guard_drift IS NOT NULL THEN
      RAISE EXCEPTION 'An application role holds DELETE on a protected agent table: %', delete_guard_drift;
    END IF;
    -- The offboarding exception ("tenant row already gone") must not be reachable by deferring a foreign key: every
    -- foreign key on the tenant-scoped guarded tables, and on agent_runs (which carries approvals), is NOT DEFERRABLE.
    SELECT string_agg(format('%s.%s', constraints.conrelid::regclass, constraints.conname), ', ') INTO delete_guard_drift
      FROM pg_constraint constraints
     WHERE constraints.contype = 'f' AND constraints.condeferrable
       AND constraints.conrelid IN ('public.agent_runtime_controls'::regclass, 'public.agent_tool_grants'::regclass,
                                    'public.agent_tool_approvals'::regclass, 'public.agent_runs'::regclass);
    IF delete_guard_drift IS NOT NULL THEN
      RAISE EXCEPTION 'A foreign key behind the migration-259 offboarding exception is deferrable: %', delete_guard_drift;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc procs
                 WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__guard_control_delete')
        OR EXISTS (SELECT 1 FROM pg_trigger triggers WHERE triggers.tgname = 'agent_control_delete_guard') THEN
    -- Fail closed on look-alike guard objects that exist before migration 259 is recorded.
    RAISE EXCEPTION 'Migration-259 guard objects exist but migration 259 (agent_control_delete_guard) is not recorded';
  END IF;

  -- UPDATE integrity of agent safety controls, grants and approvals (migration 260). Version-gated by migration NAME.
  --   H6 recorded -> the SECURITY DEFINER journal trigger function is pinned to its reviewed body (256, or 260 once
  --   recorded), so a weakened journal cannot pass by journaling less;
  --   260 recorded -> the update guard is pinned and is a plain BEFORE UPDATE row trigger on exactly 4 reviewed tables;
  --   260 not recorded -> no migration-260 guard object may exist.
  SELECT count(DISTINCT history.name) INTO update_guard_recorded FROM supabase_migrations.schema_migrations history
   WHERE history.name = 'agent_control_update_integrity';
  -- nested IF: the regprocedure literal must not be evaluated on a schema without H6
  IF h6_recorded = 2 THEN IF NOT EXISTS (
       SELECT 1 FROM pg_proc procs
        WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__journal_control_change'
          AND procs.pronargs = 0
          AND procs.prosecdef AND procs.proowner = 'postgres'::regrole AND procs.proconfig = ARRAY['search_path=""']
          AND md5(replace(procs.prosrc, chr(13), '')) = CASE WHEN update_guard_recorded > 0
                                                           THEN '30071c963f16c289896055d8e0507a42'   -- 260 body
                                                           ELSE 'e1353767acaeedce750579365ca0fc17' END  -- 256 body
          AND NOT has_function_privilege('public', procs.oid, 'EXECUTE')
          AND NOT has_function_privilege('anon', procs.oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', procs.oid, 'EXECUTE')
          AND NOT has_function_privilege('agent_worker', procs.oid, 'EXECUTE')) THEN
    -- service_role EXECUTE is tolerated (CI fixture blanket function grant; a trigger function cannot be called directly).
    RAISE EXCEPTION 'agent__journal_control_change() differs from its reviewed migration-256/260 body, owner or ACL';
  END IF; END IF;
  IF update_guard_recorded > 0 THEN
    IF delete_guard_recorded = 0 THEN
      RAISE EXCEPTION 'Migration 260 is recorded on a schema without migration 259';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc procs
                    WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__guard_control_update'
                      AND NOT procs.prosecdef AND procs.proowner = 'postgres'::regrole
                      AND procs.proconfig = ARRAY['search_path=""']
                      AND md5(replace(procs.prosrc, chr(13), '')) = '28451748327504469ba6383959ddb805'
                      AND NOT has_function_privilege('public', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('anon', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', procs.oid, 'EXECUTE')
                      AND NOT has_function_privilege('agent_worker', procs.oid, 'EXECUTE'))
       OR (SELECT count(*) FROM pg_proc procs
            WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__guard_control_update') <> 1 THEN
      RAISE EXCEPTION 'agent__guard_control_update() differs from its reviewed migration-260 body or ACL';
    END IF;
    SELECT string_agg(coalesce(wanted.table_name, found.table_name), ', ') INTO update_guard_drift
      FROM (VALUES ('agent_runtime_controls'), ('agent_tool_controls'), ('agent_tool_grants'),
                   ('agent_tool_approvals')) AS wanted(table_name)
      FULL JOIN (SELECT relations.relname::text AS table_name
                   FROM pg_trigger triggers JOIN pg_class relations ON relations.oid = triggers.tgrelid
                  WHERE triggers.tgfoid = 'public.agent__guard_control_update()'::regprocedure
                    AND triggers.tgname = 'agent_control_update_guard' AND triggers.tgenabled = 'O'
                    AND triggers.tgtype = 19  -- exactly ROW (1) + BEFORE (2) + UPDATE (16)
                    AND NOT triggers.tgisinternal AND triggers.tgconstraint = 0
                    AND triggers.tgqual IS NULL AND triggers.tgnargs = 0
                    AND triggers.tgattr = ''::int2vector                       -- no column list: every UPDATE fires
                    AND relations.relnamespace = 'public'::regnamespace) found ON found.table_name = wanted.table_name
     WHERE wanted.table_name IS NULL OR found.table_name IS NULL;
    IF update_guard_drift IS NOT NULL
       OR (SELECT count(*) FROM pg_trigger triggers
            WHERE triggers.tgfoid = 'public.agent__guard_control_update()'::regprocedure) <> 4
       OR (SELECT count(*) FROM pg_trigger triggers WHERE triggers.tgname = 'agent_control_update_guard') <> 4 THEN
      RAISE EXCEPTION 'The migration-260 UPDATE guard is missing, disabled or misplaced: %', coalesce(update_guard_drift, 'trigger count');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc procs
                 WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname = 'agent__guard_control_update')
        OR EXISTS (SELECT 1 FROM pg_trigger triggers WHERE triggers.tgname = 'agent_control_update_guard') THEN
    RAISE EXCEPTION 'Migration-260 guard objects exist but migration 260 (agent_control_update_integrity) is not recorded';
  END IF;

  -- H6 P1 worker tenant binding (migration 261, agent_worker_tenant_binding; reviewed as 257 in #239). Version-gated by
  -- migration NAME: not recorded -> no P1 object may exist; recorded -> the tenant binding, the gates, the definer
  -- surface and the reviewed bodies (CR-stripped md5, every overload) hold. 261 rebuilds the privilege detector and
  -- remover on 258/259, so it is only trusted on a schema that records 255/256 and 258-260.
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.agent_deployment_identity') IS NOT NULL
           OR to_regclass('public.agent_worker_credential_scopes') IS NOT NULL THEN 'P1 tables' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace AND procs.proname IN (
           'agent__worker_tenant', 'agent__worker_check_tenant', 'agent__worker_tenant_columns',
           'agent__guard_deployment_identity', 'agent__guard_worker_scope', 'agent__guard_worker_credential_insert',
           'agent_worker_credential_register_v2', 'agent__run_claim_scoped', 'agent__runs_recover_scoped',
           'agent__tool_approvals_expire_scoped', 'agent__model_attempts_recover_scoped'))
         THEN 'P1 functions' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'agent_worker_tenant_gate') THEN 'P1 tenant gates' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('agent_deployment_identity_guard',
           'agent_worker_credential_scopes_guard', 'agent_worker_credentials_environment_guard'))
         THEN 'P1 triggers' END], NULL) INTO p1_present;
  IF p1_recorded = 0 THEN
    IF cardinality(p1_present) > 0 THEN
      RAISE EXCEPTION 'Agent H6 P1 objects exist without migration 261 (agent_worker_tenant_binding) recorded: %', p1_present;
    END IF;
  ELSIF h6_recorded <> 2 OR exact_privileges_recorded = 0 OR delete_guard_recorded = 0 OR update_guard_recorded = 0 THEN
    RAISE EXCEPTION 'Migration 261 is recorded without 255/256 and 258-260; the schema version is not trusted';
  ELSE
    -- One RESTRICTIVE gate per worker-readable table, exactly as reviewed (the verifier also requires it on every table
    -- the worker can read); the verifier itself must be clean.
    IF (SELECT count(*) FROM public.agent__worker_tenant_columns() gates
          JOIN pg_policy policies ON policies.polrelid = format('public.%I', gates.table_name)::regclass
           AND policies.polname = 'agent_worker_tenant_gate' AND NOT policies.polpermissive AND policies.polcmd = '*'
           AND policies.polroles = ARRAY['agent_worker'::regrole::oid]
           AND pg_get_expr(policies.polqual, policies.polrelid)
               = format('(%I = ( SELECT agent__worker_tenant() AS agent__worker_tenant))', gates.column_name)) <> 8
       OR (SELECT count(*) FROM pg_policy WHERE polname = 'agent_worker_tenant_gate') <> 8
       OR EXISTS (SELECT 1 FROM public.agent_worker_privilege_violations()) THEN
      RAISE EXCEPTION 'The H6 P1 agent_worker tenant gates are missing, permissive or not as reviewed';
    END IF;
    p1_reviewed_functions := ARRAY[
      'agent__audit_protected_tables',
      'agent__control_center_journal',
      'agent__guard_control_center_event',
      'agent__guard_deployment_identity',
      'agent__guard_worker_credential',
      'agent__guard_worker_credential_insert',
      'agent__guard_worker_scope',
      'agent__journal_control_change',
      'agent__model_attempts_recover_scoped',
      'agent__refuse_truncate',
      'agent__run_claim_scoped',
      'agent__runs_recover_scoped',
      'agent__tool_approvals_expire_scoped',
      'agent__worker_allowed_rpcs',
      'agent__worker_assert',
      'agent__worker_check_tenant',
      'agent__worker_credential_ok',
      'agent__worker_read_columns',
      'agent__worker_tenant',
      'agent__worker_tenant_columns',
      'agent_audit_privilege_violations',
      'agent_audit_privileges_enforce',
      'agent_control_center_record_refusal',
      'agent_model_attempts_recover',
      'agent_run_claim',
      'agent_runs_recover',
      'agent_tool_approvals_expire',
      'agent_worker_credential_register',
      'agent_worker_credential_register_v2',
      'agent_worker_credential_revoke',
      'agent_worker_credentials_list',
      'agent_worker_privilege_violations',
      'agent_worker_rpc__agent_billing_attempt_dispatch',
      'agent_worker_rpc__agent_billing_attempt_release',
      'agent_worker_rpc__agent_billing_attempt_reserve',
      'agent_worker_rpc__agent_billing_attempt_settle',
      'agent_worker_rpc__agent_model_attempts_recover',
      'agent_worker_rpc__agent_planning_record_context',
      'agent_worker_rpc__agent_planning_record_plan',
      'agent_worker_rpc__agent_planning_step_context',
      'agent_worker_rpc__agent_run_acknowledge',
      'agent_worker_rpc__agent_run_claim',
      'agent_worker_rpc__agent_run_heartbeat',
      'agent_worker_rpc__agent_runs_recover',
      'agent_worker_rpc__agent_runtime_controls_snapshot',
      'agent_worker_rpc__agent_step_complete',
      'agent_worker_rpc__agent_step_fail',
      'agent_worker_rpc__agent_tool_approvals_expire',
      'agent_worker_rpc__agent_tool_authorization_snapshot',
      'agent_worker_rpc__agent_tool_execute_room_assignment',
      'agent_worker_rpc__agent_tool_execute_work_order_assign',
      'agent_worker_rpc__agent_tool_record_outcome',
      'agent_worker_rpc__agent_tool_request_approval',
      'agent_worker_rpc__agent_tool_step_context',
      'agent_worker_rpc__agent_worker_heartbeat'];
    -- Exactly one overload of each reviewed body, byte-identical to review (an overload under a reviewed name is never
    -- exempt). Covers the tenant source, the 23 wrappers, the scoped copies AND the unchanged originals they copy, plus
    -- every function the gates, the revocation path and least-privilege enforcement depend on. 52 bodies are exactly the
    -- #239 review; the detector and the remover are the 261 bodies (259/258 + the P1 additions) and the journal trigger
    -- function is the 260 body.
    IF (SELECT count(*) FROM pg_proc procs JOIN (VALUES
      ('agent__guard_deployment_identity', '912523371852d722d49e3d5a7372e7ea'),
      ('agent__guard_worker_credential_insert', '362e5c496873265560b67620d72ffead'),
      ('agent__guard_worker_scope', 'fb675bc2a321d0172942fcaab4ddc829'),
      ('agent__model_attempts_recover_scoped', 'a2a47c8bf7d0cb3913a648d029fa49db'),
      ('agent__run_claim_scoped', 'd72df21b2232d30331f5718386574987'),
      ('agent__runs_recover_scoped', '89ec8fd77ada7edc6a43c671a8b2ae31'),
      ('agent__tool_approvals_expire_scoped', 'd9a53620d556189ebbb06a866583376d'),
      ('agent__worker_assert', 'a023066fbaeef6310b63e2bf0b57f091'),
      ('agent__worker_check_tenant', '04d55a82a1a6713ec9c47a0c4e5c90fc'),
      ('agent__worker_credential_ok', '72d3bac9263ac497fc014b77b6151bc7'),
      ('agent__worker_tenant', 'f0083c4496ce53054ceb035503844e46'),
      ('agent_model_attempts_recover', '5da9c7b8897f25a344954e9178296ac8'),
      ('agent_run_claim', 'fa90e788d9885ba202996104d04cfe6f'),
      ('agent_runs_recover', '316e0651e584ef5e187ee24b2af86acd'),
      ('agent_tool_approvals_expire', '21835f066137a596c5002d82d510a20e'),
      ('agent_worker_credential_register_v2', '8483bba9676c731d43d74d338cc8c253'),
      ('agent_worker_credential_register', '9d0638223ba9995c01c735b69adcc6ec'),
      ('agent_worker_rpc__agent_billing_attempt_dispatch', 'b00795a727880c4156165bb253521ca1'),
      ('agent_worker_rpc__agent_billing_attempt_release', 'd0376b79a12e86fb596719cbd60b63f0'),
      ('agent_worker_rpc__agent_billing_attempt_reserve', '30f050fb024de3bc488b190dc4a4b30a'),
      ('agent_worker_rpc__agent_billing_attempt_settle', '63da6043c1131151bb7cea729d5772e3'),
      ('agent_worker_rpc__agent_model_attempts_recover', '0821439f53d79dd91b06febd3513286a'),
      ('agent_worker_rpc__agent_planning_record_context', 'ad6f6c400f9bdc832a66f2d38078c2a1'),
      ('agent_worker_rpc__agent_planning_record_plan', 'cb7262460d0e51d5e1d8a8d9c95c881b'),
      ('agent_worker_rpc__agent_planning_step_context', 'f842feb50c97005c05d2c2ba75acd632'),
      ('agent_worker_rpc__agent_run_acknowledge', 'be9a23632d8ba82ca3e1a726f4cc7474'),
      ('agent_worker_rpc__agent_run_claim', '4b0de437224a254c5362a22809861d59'),
      ('agent_worker_rpc__agent_run_heartbeat', '1834080ab13543fd410414cf3dac8b66'),
      ('agent_worker_rpc__agent_runs_recover', 'd5031fb4a92fd2c8523f3ae76247d695'),
      ('agent_worker_rpc__agent_runtime_controls_snapshot', '085dfade9b983a84d042d78bd19fe405'),
      ('agent_worker_rpc__agent_step_complete', 'c449a8e8a3de47395769dfeddeeec7a0'),
      ('agent_worker_rpc__agent_step_fail', '0509a60fd87b08859906859b3f8d69ed'),
      ('agent_worker_rpc__agent_tool_approvals_expire', 'd1a812dc85deafc9db3976caa5971f5b'),
      ('agent_worker_rpc__agent_tool_authorization_snapshot', '36a01549958d7780d84a9e10c4b837e8'),
      ('agent_worker_rpc__agent_tool_execute_room_assignment', 'c58d58426072a8b172aaa52dd4b3e55c'),
      ('agent_worker_rpc__agent_tool_execute_work_order_assign', '40298a74885ee3189e2602510e6e0852'),
      ('agent_worker_rpc__agent_tool_record_outcome', '534a1849ddca3e979c2ad62ca38cfeb2'),
      ('agent_worker_rpc__agent_tool_request_approval', '505b5eee6b862f29aa9eb962748c655c'),
      ('agent_worker_rpc__agent_tool_step_context', 'f1273f6cf8f3248f3c5c845f0682c992'),
      ('agent_worker_rpc__agent_worker_heartbeat', 'aded91ae2d2539813bd04f4cfa449e56'),
      ('agent__audit_protected_tables', '053460f2c1ab782880c9ac6c761297c7'),
      ('agent__control_center_journal', '8e1a80ddc5bcd91d76998ebb57f850c1'),
      ('agent__guard_control_center_event', '1e0e01706555a3f666653617582efa16'),
      ('agent__guard_worker_credential', 'ec55c1ecff805a61a6ff3e8da232d5fe'),
      ('agent__journal_control_change', '30071c963f16c289896055d8e0507a42'),  -- 260 body
      ('agent__refuse_truncate', '0a217d89e62cc3aa98c4812add14e664'),
      ('agent__worker_allowed_rpcs', '6f684ff20e91087368b44c8656d05de8'),
      ('agent__worker_read_columns', 'a6ed7dbc6e5243445c9d972981548032'),
      ('agent__worker_tenant_columns', '83cd542f659e324dac3d142ee81e5162'),
      ('agent_audit_privilege_violations', '2dfcdf8e75aaceb2c2ae479d3d70bcae'),  -- 261 body (259 + P1)
      ('agent_audit_privileges_enforce', 'd0f41069966294caac73007797c4706b'),    -- 261 body (258 + P1)
      ('agent_control_center_record_refusal', '79fb9fe68243f3c721e9cfa1fd6c60d5'),
      ('agent_worker_credential_revoke', '3cf72966bbc37d4785a330cdf4024e74'),
      ('agent_worker_credentials_list', '6736a910aa0abf8ed51ea6d90aab4a30'),
      ('agent_worker_privilege_violations', '36a5cc20c0424f91a07a8111d3d8118e')
         ) AS pins(proname, body_md5) ON pins.proname = procs.proname
         WHERE procs.pronamespace = 'public'::regnamespace AND md5(replace(procs.prosrc, chr(13), '')) = pins.body_md5) <> 55
       OR (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
             AND procs.proname = ANY (p1_reviewed_functions)) <> 55 THEN
      RAISE EXCEPTION 'An H6 P1 reviewed function body changed, is missing or is overloaded';
    END IF;
    -- The same 55 functions by signature: identity arguments, result type, SECURITY DEFINER, volatility and the pinned
    -- search_path. A body pin alone would not notice a definer flip, a changed argument list or return type.
    IF (SELECT md5(string_agg(format('%s(%s)|%s|%s|%s|%s', procs.proname, pg_get_function_identity_arguments(procs.oid),
                                     pg_get_function_result(procs.oid), procs.prosecdef, procs.provolatile,
                                     COALESCE(array_to_string(procs.proconfig, ','), '-')),
                              E'\n' ORDER BY procs.proname, pg_get_function_identity_arguments(procs.oid)))
          FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
           AND procs.proname = ANY (p1_reviewed_functions)) IS DISTINCT FROM '9fc1c91f1f121ef1fb93615e2db876b2' THEN
      RAISE EXCEPTION 'An H6 P1 reviewed function signature, definer flag, volatility or search_path changed';
    END IF;
    -- The identity arguments above omit DEFAULT expressions, yet a default decides what a caller gets when it omits an
    -- argument (lease, stale threshold, retry budget, limit). The same 55 by full argument list: names, modes, types
    -- and every default expression (pg_get_function_arguments).
    IF (SELECT md5(string_agg(format('%s(%s)', procs.proname, pg_get_function_arguments(procs.oid)),
                              E'\n' ORDER BY procs.proname, pg_get_function_identity_arguments(procs.oid)))
          FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
           AND procs.proname = ANY (p1_reviewed_functions)) IS DISTINCT FROM '6e200c2bb77389662451344a37421b78' THEN
      RAISE EXCEPTION 'An H6 P1 reviewed function argument name, mode or default changed';
    END IF;
    -- Owner-only helpers stay owner-only; the tenant source is executable by agent_worker alone; scoped copies are INVOKER.
    IF EXISTS (SELECT 1 FROM public.agent_audit_privilege_violations())
       OR (SELECT count(*) FROM pg_proc procs WHERE procs.pronamespace = 'public'::regnamespace
             AND procs.proname IN ('agent__run_claim_scoped', 'agent__runs_recover_scoped',
                                   'agent__tool_approvals_expire_scoped', 'agent__model_attempts_recover_scoped',
                                   'agent__worker_check_tenant')
             AND NOT procs.prosecdef AND procs.proconfig = ARRAY['search_path=""']) <> 5
       OR has_function_privilege('service_role', 'public.agent__worker_tenant()'::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('agent_worker', 'public.agent__worker_tenant()'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'An H6 P1 helper is exposed, SECURITY DEFINER or not pinned to an empty search_path';
    END IF;
    IF (SELECT count(*) FROM pg_trigger triggers WHERE triggers.tgenabled = 'O' AND (
          (triggers.tgname = 'agent_deployment_identity_guard' AND triggers.tgrelid = 'public.agent_deployment_identity'::regclass)
          OR (triggers.tgname = 'agent_worker_credential_scopes_guard' AND triggers.tgrelid = 'public.agent_worker_credential_scopes'::regclass)
          OR (triggers.tgname = 'agent_worker_credentials_environment_guard' AND triggers.tgrelid = 'public.agent_worker_credentials'::regclass))) <> 3
       OR has_any_column_privilege('service_role', 'public.agent_deployment_identity'::regclass, 'INSERT') THEN
      RAISE EXCEPTION 'An H6 P1 binding guard trigger is missing or disabled, or the deployment identity is writable';
    END IF;
    -- The two P1 tables keep RLS on and grant nothing to end users or the worker (service_role reads them; only the
    -- reviewed registration path inserts scopes; only the owner stamps the identity).
    IF (SELECT count(*) FROM pg_class relations
         WHERE relations.oid IN ('public.agent_deployment_identity'::regclass, 'public.agent_worker_credential_scopes'::regclass)
           AND relations.relrowsecurity) <> 2
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.agent_deployment_identity', 'public.agent_worker_credential_scopes']) AS p1_tables(name)
                   CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'agent_worker']) AS grantees(role_name)
                   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS rights(privilege)
                   WHERE has_any_column_privilege(grantees.role_name, p1_tables.name::regclass, rights.privilege))
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.agent_deployment_identity', 'public.agent_worker_credential_scopes']) AS p1_tables(name)
                   CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'agent_worker']) AS grantees(role_name)
                   CROSS JOIN unnest(ARRAY['DELETE', 'TRUNCATE', 'TRIGGER']) AS rights(privilege)
                   WHERE has_table_privilege(grantees.role_name, p1_tables.name::regclass, rights.privilege)) THEN
      RAISE EXCEPTION 'An H6 P1 table lost RLS or is accessible to an end-user or worker role';
    END IF;
    -- Revocation is final: no credential the immutable journal records as revoked may be active again (a revoked jti
    -- regaining tenancy means its row was rewritten or re-created behind the guard triggers).
    IF EXISTS (SELECT 1 FROM public.agent_worker_credentials credentials
                WHERE credentials.revoked_at IS NULL
                  AND EXISTS (SELECT 1 FROM public.agent_control_center_events events
                               WHERE events.event_type = 'worker_credential_revoked'
                                 AND events.subject_type = 'worker_credential'
                                 AND events.subject_ref = credentials.id::text)) THEN
      RAISE EXCEPTION 'A worker credential recorded as revoked is active again';
    END IF;
  END IF;
END;
$$;
