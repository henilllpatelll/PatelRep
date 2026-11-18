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
    -- The registry is exactly every harness table (31 / 11 append-only; 33 / 12 once H6 is recorded) and names only
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
END;
$$;
