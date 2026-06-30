-- Merge chief_engineer into engineer.
-- Most hotels have one engineer, not a two-tier engineering department.

-- 1. Migrate existing user_roles data
UPDATE user_roles SET role = 'engineer' WHERE role = 'chief_engineer';

-- 2. Migrate staff_role_schedules: engineer → chief_engineer overrides are now meaningless;
--    delete them and tighten the constraint.
DELETE FROM staff_role_schedules WHERE override_role = 'chief_engineer';
ALTER TABLE staff_role_schedules DROP CONSTRAINT IF EXISTS staff_role_schedules_override_role_check;
ALTER TABLE staff_role_schedules ADD CONSTRAINT staff_role_schedules_override_role_check
  CHECK (override_role IN ('housekeeping_supervisor', 'engineer'));

-- 3. Drop and recreate user_roles CHECK to remove chief_engineer
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('gm', 'housekeeping_supervisor', 'front_desk', 'housekeeper', 'engineer'));
COMMENT ON COLUMN user_roles.role IS 'One of: gm, housekeeping_supervisor, front_desk, housekeeper, engineer.';

-- 4. Update RLS: assigned_task_update (was gm|housekeeping_supervisor|chief_engineer|front_desk)
DROP POLICY IF EXISTS "assigned_task_update" ON public.tasks;
CREATE POLICY "assigned_task_update" ON public.tasks
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) = ANY (ARRAY['gm','housekeeping_supervisor','engineer','front_desk'])
      OR assigned_to = (SELECT auth.uid())
    )
  );

-- 5. Update RLS: assigned_work_order_update (was gm|chief_engineer|front_desk)
DROP POLICY IF EXISTS "assigned_work_order_update" ON public.work_orders;
CREATE POLICY "assigned_work_order_update" ON public.work_orders
  FOR UPDATE USING (
    tenant_id = (((SELECT auth.jwt()) ->> 'hotel_id'::text))::uuid
    AND (
      ((SELECT auth.jwt()) ->> 'role'::text) = ANY (ARRAY['gm','engineer','front_desk'])
      OR assigned_to = (SELECT auth.uid())
    )
  );
