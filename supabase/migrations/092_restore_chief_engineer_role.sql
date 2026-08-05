-- =============================================================================
-- Migration 092: Restore chief_engineer to user_roles CHECK constraint
-- =============================================================================
-- Migration 064 merged chief_engineer into engineer at the DB layer ("most
-- hotels have one engineer, not a two-tier engineering department") and
-- tightened user_roles_role_check to 5 values (gm, housekeeping_supervisor,
-- front_desk, housekeeper, engineer), dropping chief_engineer.
--
-- That merge was never carried through the application layer. chief_engineer
-- is a fully live, distinct role throughout current app code, added/kept
-- *after* migration 064 across many surfaces: core/roles.py MANAGER_ROLES,
-- routers/{safety,programs,evidence,ai_copilot,assets,integrations}.py RBAC
-- gates, apps/web/lib/utils/routeGuard.ts ALL_ROLES + /engineering route
-- rule, apps/web/app/(dashboard)/staff/page.tsx's "Chief Engineer" option in
-- the Add Staff form (client-validated by a zod enum that includes it), and
-- the engineering Work Orders canManage gate (engineering/work-orders/
-- page.tsx) which deliberately treats chief_engineer as distinct from
-- engineer. Net effect: no hotel using this product can actually create a
-- chief_engineer user today -- POST /staff/add-direct and /staff/invite
-- 400/422, and any attempted user_roles insert 23514s against this
-- constraint -- even though the UI offers it and >15 backend RBAC gates
-- branch on it. Found while seeding a chief_engineer test user for Phase 20
-- VERIFY-01 (Engineering Work Orders archive-button role gate) verification.
--
-- This migration only widens the constraint back to include chief_engineer.
-- It does not touch the two RLS policies migration 064 narrowed
-- (assigned_task_update, assigned_work_order_update), which currently allow
-- gm/housekeeping_supervisor/engineer/front_desk (tasks) and gm/engineer/
-- front_desk (work orders) to manage records assigned to others, plus
-- self-assigned records for any role -- excluding chief_engineer from
-- managing *others'* assignments there matches the same restriction already
-- deliberately applied in canManage on the Work Orders page (engineer||gm
-- only), so it is left as-is pending a product decision on that surface.
-- =============================================================================

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('gm', 'housekeeping_supervisor', 'front_desk', 'housekeeper', 'engineer', 'chief_engineer'));
COMMENT ON COLUMN user_roles.role IS 'One of: gm, housekeeping_supervisor, front_desk, housekeeper, engineer, chief_engineer.';
