-- =============================================================================
-- Migration 016: Row Level Security Policies
-- Tenant data isolation and role-based access for all tables
-- =============================================================================
-- All RLS policies rely on two JWT custom claims injected by the Supabase
-- Auth hook (set in the auth.jwt() payload):
--   hotel_id  : UUID of the tenant the user belongs to
--   role      : the user's primary role string (e.g. "gm", "housekeeper")
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
ALTER TABLE tenants                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_group_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE opera_credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_types                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_status                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_status_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_assignments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_schedules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE failure_predictions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_chunks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_requests              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lost_found_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE opera_reservations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE logbook_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_summaries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_interactions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_readiness_predictions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeper_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger               ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- tenants
-- A user may only see their own hotel record.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON tenants
  FOR ALL
  USING (id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- tenant_groups
-- Only the group owner can access group records.
-- ---------------------------------------------------------------------------
CREATE POLICY "group_owner_access" ON tenant_groups
  FOR ALL
  USING (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- tenant_group_memberships
-- Accessible if the tenant in the membership row belongs to this user's hotel.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON tenant_group_memberships
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- opera_credentials
-- Only GM role can access PMS credentials for the hotel.
-- ---------------------------------------------------------------------------
CREATE POLICY "gm_opera_access" ON opera_credentials
  FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );

-- ---------------------------------------------------------------------------
-- departments
-- All staff can view their hotel's departments.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON departments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- user_profiles
-- Users can see profiles for their hotel; they can only update their own.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON user_profiles
  FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

CREATE POLICY "own_profile_write" ON user_profiles
  FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "own_profile_insert" ON user_profiles
  FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- user_roles
-- All hotel staff can view roles; only GM can modify.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation_select" ON user_roles
  FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

CREATE POLICY "gm_role_write" ON user_roles
  FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );

CREATE POLICY "gm_role_update" ON user_roles
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );

-- ---------------------------------------------------------------------------
-- staff_invitations
-- GM can manage invitations; invited user can read their own via token.
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON staff_invitations
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- room_types
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON room_types
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON rooms
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- room_status
-- Housekeepers only see rooms assigned to them; all other roles see all rooms.
-- ---------------------------------------------------------------------------
CREATE POLICY "housekeeper_own_rooms" ON room_status
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') != 'housekeeper'
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "supervisor_write" ON room_status
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') IN ('gm', 'housekeeping_supervisor', 'front_desk')
      OR assigned_to = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- room_status_history
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON room_status_history
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- room_assignments
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON room_assignments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON shifts
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- shift_assignments
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON shift_assignments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- tasks
-- Housekeepers only see tasks assigned to them; supervisors/GM see all.
-- ---------------------------------------------------------------------------
CREATE POLICY "housekeeper_own_tasks" ON tasks
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') NOT IN ('housekeeper', 'engineer')
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "staff_task_write" ON tasks
  FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

CREATE POLICY "assigned_task_update" ON tasks
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') IN ('gm', 'housekeeping_supervisor', 'chief_engineer', 'front_desk')
      OR assigned_to = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- task_comments
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON task_comments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- work_orders
-- Engineers only see work orders assigned to them; supervisors/GM see all.
-- ---------------------------------------------------------------------------
CREATE POLICY "engineer_own_work_orders" ON work_orders
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') != 'engineer'
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "staff_work_order_write" ON work_orders
  FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

CREATE POLICY "assigned_work_order_update" ON work_orders
  FOR UPDATE
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (
      (auth.jwt() ->> 'role') IN ('gm', 'chief_engineer', 'front_desk')
      OR assigned_to = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- work_order_photos
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON work_order_photos
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- work_order_comments
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON work_order_comments
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- asset_categories
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON asset_categories
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON assets
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- pm_schedules
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON pm_schedules
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- failure_predictions
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON failure_predictions
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- inspection_templates
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON inspection_templates
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- inspection_template_items
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON inspection_template_items
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- inspections
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON inspections
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- inspection_results
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON inspection_results
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- sop_documents
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON sop_documents
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- sop_chunks
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON sop_chunks
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- guest_requests
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON guest_requests
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- lost_found_items
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON lost_found_items
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- opera_reservations
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON opera_reservations
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- logbook_entries
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON logbook_entries
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- shift_summaries
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON shift_summaries
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- ai_interactions
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON ai_interactions
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- room_readiness_predictions
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON room_readiness_predictions
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- housekeeper_profiles
-- ---------------------------------------------------------------------------
CREATE POLICY "tenant_isolation" ON housekeeper_profiles
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'hotel_id')::uuid);

-- ---------------------------------------------------------------------------
-- notifications
-- Users can only access their own notifications.
-- ---------------------------------------------------------------------------
CREATE POLICY "own_notifications" ON notifications
  FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- subscriptions
-- Only GM role can view or modify subscription records.
-- ---------------------------------------------------------------------------
CREATE POLICY "gm_billing_access" ON subscriptions
  FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );

-- ---------------------------------------------------------------------------
-- credit_ledger
-- Only GM role can view credit ledger records.
-- ---------------------------------------------------------------------------
CREATE POLICY "gm_billing_access" ON credit_ledger
  FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );
