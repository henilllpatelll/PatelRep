/** Who may open the Team Schedule screen. The server re-checks every request (and scopes it to the supervisor's
 *  department); this only keeps the screen — and its entry point — away from roles that have no use for it. */
export const TEAM_SCHEDULE_ROLES = ["housekeeping_supervisor"] as const;

export function canViewTeamSchedule(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && (TEAM_SCHEDULE_ROLES as readonly string[]).includes(role);
}
