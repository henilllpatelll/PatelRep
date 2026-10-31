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
