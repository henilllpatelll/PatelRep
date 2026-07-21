-- Lock down RLS-bypassing SECURITY DEFINER RPCs to service_role only.
--
-- Supabase grants EXECUTE on new public functions to the `anon` and
-- `authenticated` roles directly (via default privileges). `REVOKE ... FROM
-- PUBLIC` (as attempted in migration 075) does NOT remove those direct grants,
-- so these functions remained callable through PostgREST at /rest/v1/rpc/*.
-- Because they are SECURITY DEFINER (bypass RLS) and take p_tenant_id / p_actor_id
-- as parameters, any holder of the public anon key could invoke them against an
-- arbitrary tenant, bypassing the FastAPI RBAC and tenant-isolation layer.
--
-- The FastAPI backend calls these with the service_role key, which retains
-- EXECUTE, so restricting anon/authenticated is non-breaking.

REVOKE EXECUTE ON FUNCTION public.supersede_controlled_document_with_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_evidence_reminder_delivery(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_retraining_assignments_for_approved_document() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_work_order_with_audit(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.supersede_controlled_document_with_audit(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_evidence_reminder_delivery(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_retraining_assignments_for_approved_document() TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_work_order_with_audit(UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID) TO service_role;
