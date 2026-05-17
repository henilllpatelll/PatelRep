-- Fix auth_rls_initplan: wrap auth.jwt() and auth.uid() with (SELECT ...) so they
-- are evaluated once per query instead of once per row.

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_interactions','asset_categories','assets','departments','failure_predictions',
    'guest_requests','housekeeper_profiles','inspection_results','inspection_template_items',
    'inspection_templates','inspections','logbook_entries','lost_found_items',
    'opera_reservations','pm_schedules','room_assignments','room_readiness_predictions',
    'room_status_history','room_types','rooms','shift_assignments','shift_summaries',
    'shifts','sop_chunks','sop_documents','staff_invitations','task_comments',
    'tenant_group_memberships','work_order_comments','work_order_photos'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON public.%I FOR ALL USING (tenant_id = (((SELECT auth.jwt()) ->> ''hotel_id''::text))::uuid)',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "tenant_isolation" ON public.tenants;
CREATE POLICY "tenant_isolation" ON public.tenants
  FOR ALL USING (id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "gm_billing_access" ON public.credit_ledger;
CREATE POLICY "gm_billing_access" ON public.credit_ledger
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND ((SELECT auth.jwt()) ->> 'role'::text) = 'gm'::text
  );

DROP POLICY IF EXISTS "gm_billing_access" ON public.subscriptions;
CREATE POLICY "gm_billing_access" ON public.subscriptions
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND ((SELECT auth.jwt()) ->> 'role'::text) = 'gm'::text
  );

DROP POLICY IF EXISTS "gm_opera_access" ON public.opera_credentials;
CREATE POLICY "gm_opera_access" ON public.opera_credentials
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND ((SELECT auth.jwt()) ->> 'role'::text) = 'gm'::text
  );

DROP POLICY IF EXISTS "own_notifications" ON public.notifications;
CREATE POLICY "own_notifications" ON public.notifications
  FOR ALL USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "housekeeper_own_rooms" ON public.room_status;
CREATE POLICY "housekeeper_own_rooms" ON public.room_status
  FOR SELECT USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (((SELECT auth.jwt()) ->> 'role'::text) <> 'housekeeper'::text OR assigned_to = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "supervisor_write" ON public.room_status;
CREATE POLICY "supervisor_write" ON public.room_status
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) = ANY (ARRAY['gm','housekeeping_supervisor','front_desk'])
      OR assigned_to = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "housekeeper_own_tasks" ON public.tasks;
CREATE POLICY "housekeeper_own_tasks" ON public.tasks
  FOR SELECT USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) <> ALL (ARRAY['housekeeper','engineer'])
      OR assigned_to = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_task_write" ON public.tasks;
CREATE POLICY "staff_task_write" ON public.tasks
  FOR INSERT WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "assigned_task_update" ON public.tasks;
CREATE POLICY "assigned_task_update" ON public.tasks
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) = ANY (ARRAY['gm','housekeeping_supervisor','chief_engineer','front_desk'])
      OR assigned_to = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "group_owner_access" ON public.tenant_groups;
CREATE POLICY "group_owner_access" ON public.tenant_groups
  FOR ALL USING (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "tenant_isolation" ON public.user_profiles;
CREATE POLICY "tenant_isolation" ON public.user_profiles
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "own_profile_write" ON public.user_profiles;
CREATE POLICY "own_profile_write" ON public.user_profiles
  FOR UPDATE USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "own_profile_insert" ON public.user_profiles;
CREATE POLICY "own_profile_insert" ON public.user_profiles
  FOR INSERT WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "tenant_isolation_select" ON public.user_roles;
CREATE POLICY "tenant_isolation_select" ON public.user_roles
  FOR SELECT USING (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "gm_role_write" ON public.user_roles;
CREATE POLICY "gm_role_write" ON public.user_roles
  FOR INSERT WITH CHECK (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND ((SELECT auth.jwt()) ->> 'role'::text) = 'gm'::text
  );

DROP POLICY IF EXISTS "gm_role_update" ON public.user_roles;
CREATE POLICY "gm_role_update" ON public.user_roles
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND ((SELECT auth.jwt()) ->> 'role'::text) = 'gm'::text
  );

DROP POLICY IF EXISTS "engineer_own_work_orders" ON public.work_orders;
CREATE POLICY "engineer_own_work_orders" ON public.work_orders
  FOR SELECT USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) <> 'engineer'::text
      OR assigned_to = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_work_order_write" ON public.work_orders;
CREATE POLICY "staff_work_order_write" ON public.work_orders
  FOR INSERT WITH CHECK (tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid);

DROP POLICY IF EXISTS "assigned_work_order_update" ON public.work_orders;
CREATE POLICY "assigned_work_order_update" ON public.work_orders
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) = ANY (ARRAY['gm','chief_engineer','front_desk'])
      OR assigned_to = (SELECT auth.uid())
    )
  );
