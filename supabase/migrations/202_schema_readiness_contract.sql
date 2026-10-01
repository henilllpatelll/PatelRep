-- Versioned, data-free contract used by API /ready and the migration gate.
-- This checks only the high-impact objects the current application relies on.
CREATE OR REPLACE FUNCTION public.app_schema_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  missing_contracts text[];
BEGIN
  SELECT coalesce(array_agg(contract_name ORDER BY contract_name), ARRAY[]::text[])
  INTO missing_contracts
  FROM (
    SELECT format('%s.%s', required.table_name, required.column_name) AS contract_name
    FROM (
      VALUES
        ('room_status', 'clean_type'),
        ('room_assignments', 'assigned_to'),
        ('inspection_results', 'template_item_id'),
        ('work_orders', 'asset_id'),
        ('assets', 'last_failure_at'),
        ('tasks', 'status'),
        ('logbook_entries', 'entry_date'),
        ('lost_found_items', 'voided_at'),
        ('lost_found_claims', 'matched_item_id'),
        ('lost_found_returns', 'status')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns columns
      WHERE columns.table_schema = 'public'
        AND columns.table_name = required.table_name
        AND columns.column_name = required.column_name
    )
    UNION ALL
    SELECT required.function_name
    FROM (VALUES ('match_sop_chunks'), ('transition_work_order_with_audit')) AS required(function_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_proc procedures
      JOIN pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
      WHERE namespaces.nspname = 'public' AND procedures.proname = required.function_name
    )
    UNION ALL
    SELECT required.extension_name
    FROM (VALUES ('pgcrypto'), ('vector')) AS required(extension_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_extension extensions WHERE extensions.extname = required.extension_name
    )
  ) missing;

  RETURN jsonb_build_object(
    'ok', coalesce(array_length(missing_contracts, 1), 0) = 0,
    'missing', to_jsonb(missing_contracts),
    'schema_contract_version', 130
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_schema_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_schema_readiness() TO anon, authenticated, service_role;
