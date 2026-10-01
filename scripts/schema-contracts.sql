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
    'logbook_entries', 'lost_found_items', 'lost_found_claims', 'lost_found_returns'
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
END;
$$;
