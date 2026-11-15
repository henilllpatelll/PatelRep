-- Executed only against an isolated migrated database (CI or local Supabase).
-- Keep this focused: it protects high-impact API contracts, not every column.
DO $$
DECLARE
  readiness jsonb;
  rls_table text;
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
    'agent_model_budget_counters', 'agent_model_attempts', 'agent_model_spend_events', 'agent_planning_runs',
    'agent_planning_events', 'agent_proposal_handoffs'
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
  ) THEN
    RAISE EXCEPTION 'An Agent Harness function is SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class relations
    JOIN pg_namespace namespaces ON namespaces.oid = relations.relnamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS end_users(role_name)
    WHERE namespaces.nspname = 'public' AND relations.relkind = 'r'
      AND (relations.relname LIKE 'agent_model_%'
           OR relations.relname IN ('agent_planning_runs', 'agent_planning_events', 'agent_proposal_handoffs'))
      AND (has_table_privilege(end_users.role_name, relations.oid, 'SELECT')
           OR has_table_privilege(end_users.role_name, relations.oid, 'INSERT')
           OR has_table_privilege(end_users.role_name, relations.oid, 'UPDATE')
           OR has_table_privilege(end_users.role_name, relations.oid, 'DELETE'))
  ) THEN
    RAISE EXCEPTION 'An H3/H5 ledger, planning or handoff table is accessible to anon or authenticated';
  END IF;
  IF (SELECT count(*) FROM public.agent_model_enablement) <> 1 THEN
    RAISE EXCEPTION 'agent_model_enablement must hold exactly one row';
  END IF;
  IF (SELECT count(*) FROM public.agent_model_price_schedules WHERE schedule_version IN
        ('openai-2026-11-14', 'anthropic-2026-11-14')) <> 4 THEN
    RAISE EXCEPTION 'The reviewed H3 price book seed is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_runs'::regclass
                   AND conname = 'agent_runs_h5_agent_allowlist' AND convalidated) THEN
    RAISE EXCEPTION 'agent_runs_h5_agent_allowlist is missing';
  END IF;
  IF public.agent__gateway_tool_spec('housekeeping.room_readiness_assistant', 1, 'engineering.work_orders.assign', 2)
       IS NOT NULL
     OR public.agent__gateway_tool_spec('engineering.dispatch_assistant', 2, 'housekeeping.room_assignments.assign', 1)
       IS NOT NULL
     OR public.agent__gateway_tool_spec('housekeeping.room_readiness_assistant', 1, 'housekeeping.room_assignments.assign', 1)
          ->>'risk' IS DISTINCT FROM 'high' THEN
    RAISE EXCEPTION 'The H5 gateway allowlist crosses departments or lost the high-risk classification';
  END IF;
END;
$$;
