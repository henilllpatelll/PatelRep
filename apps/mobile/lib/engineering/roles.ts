/* ─── Engineering role model ────────────────────────────────────────────────
   Mirrors apps/api/core/roles.py and the work-order / asset guards. These
   helpers only decide what the UI offers — the server enforces every rule, so
   nothing here grants a permission.

   chief_engineer is a live, distinct role (migration 092 restored it after 064
   merged it away). The API lets it read every work order and run PM, downtime,
   meter, checklist, snooze and merge workflows, but NOT claim, transition,
   edit or complete a work order (those guards are engineer + gm only). */

export const ENGINEERING_ROLES = ["engineer", "chief_engineer"] as const;
export type EngineeringRole = (typeof ENGINEERING_ROLES)[number];

export function isEngineeringRole(role: string | null | undefined): role is EngineeringRole {
  return role != null && (ENGINEERING_ROLES as readonly string[]).includes(role);
}

/** claim / transition / edit / complete a work order — API guard `require_role("engineer", "gm")`. */
const WORK_ORDER_ACTOR_ROLES: readonly string[] = ["engineer", "gm"];

export function canActOnWorkOrders(role: string | null | undefined): boolean {
  return role != null && WORK_ORDER_ACTOR_ROLES.includes(role);
}

/** Complete a PM with checklist evidence — API guard `require_role("engineer", "gm", "chief_engineer")`. */
const PM_COMPLETION_ROLES: readonly string[] = ["engineer", "gm", "chief_engineer"];

export function canCompletePm(role: string | null | undefined): boolean {
  return role != null && PM_COMPLETION_ROLES.includes(role);
}

/** Record a meter reading - API guard `require_role("engineer", "chief_engineer", "gm")`. */
const READING_ROLES: readonly string[] = ["engineer", "chief_engineer", "gm"];

export function canRecordReadings(role: string | null | undefined): boolean {
  return role != null && READING_ROLES.includes(role);
}

/** Open a work order from a failure signal or acknowledge one - API guard `require_role("gm", "engineer")`. */
const SIGNAL_ACTOR_ROLES: readonly string[] = ["engineer", "gm"];

export function canActOnSignals(role: string | null | undefined): boolean {
  return role != null && SIGNAL_ACTOR_ROLES.includes(role);
}

/** Own the schedules (create, edit, reschedule, retire, bind a checklist) - API guard `require_role("chief_engineer", "gm")`.
 *  A line engineer executes a PM but cannot move its due date or retire it. */
const PM_SCHEDULE_MANAGER_ROLES: readonly string[] = ["chief_engineer", "gm"];

export function canManagePmSchedules(role: string | null | undefined): boolean {
  return role != null && PM_SCHEDULE_MANAGER_ROLES.includes(role);
}

/** Request a deferral - API guard `require_role("chief_engineer", "gm")`. */
export function canRequestPmDeferral(role: string | null | undefined): boolean {
  return canManagePmSchedules(role);
}

/**
 * Decide a deferral request. The reviewer must be a different person from the requester - the API refuses a self-review,
 * so the UI does not offer it.
 */
export function canReviewPmDeferral(role: string | null | undefined, requestedBy: string | null | undefined, userId: string | null | undefined): boolean {
  return canManagePmSchedules(role) && !!userId && !!requestedBy && requestedBy !== userId;
}

/** Create and edit equipment records - API guard `require_role("engineer", "chief_engineer", "gm")`. */
const ASSET_MANAGER_ROLES: readonly string[] = ["engineer", "chief_engineer", "gm"];

export function canManageAssets(role: string | null | undefined): boolean {
  return role != null && ASSET_MANAGER_ROLES.includes(role);
}

/** Retire equipment - API guard `require_role("chief_engineer", "gm")`. A line engineer registers and corrects records but does not retire them. */
const ASSET_RETIRE_ROLES: readonly string[] = ["chief_engineer", "gm"];

export function canRetireAssets(role: string | null | undefined): boolean {
  return role != null && ASSET_RETIRE_ROLES.includes(role);
}
