-- Hardening for 210_task_blockers (additive, forward-only; 210 itself is untouched).
-- 1. 210 granted FOR ALL on the tenant: any signed-in member of a hotel could INSERT / UPDATE / DELETE blocker rows
--    straight through PostgREST (forge a report as someone else, resolve or erase one). Rows are written only by the
--    API (service role, which bypasses RLS), so clients get tenant-scoped SELECT and nothing else.
-- 2. FK columns without a leading index (tenant_id cascade deletes, resolved_by) get one, per the 038 convention.

-- migration-safety: destructive-reviewed
-- rollback-plan: recreate the FOR ALL policy from 210 (CREATE POLICY "tenant_isolation" ON public.task_blockers FOR ALL USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid)); the policy drop removes no data, only client write access the API never used.
DROP POLICY IF EXISTS "tenant_isolation" ON public.task_blockers;
DROP POLICY IF EXISTS "tenant_isolation_select" ON public.task_blockers;

CREATE POLICY "tenant_isolation_select" ON public.task_blockers
  FOR SELECT
  USING (tenant_id = ((SELECT auth.jwt()) ->> 'hotel_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_task_blockers_tenant ON public.task_blockers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_blockers_resolved_by ON public.task_blockers (resolved_by) WHERE resolved_by IS NOT NULL;
