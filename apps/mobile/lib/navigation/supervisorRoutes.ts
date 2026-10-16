/* ─── Supervisor navigation contract ────────────────────────────────────────
   Where a supervisor Today item may send the user. Only routes that exist AND
   serve supervisors are listed. Supervisor actions never land in housekeeper-only
   screens (`my-rooms`, the housekeeper Attention Center).

   Record deep links do not exist yet: the supervisor Rooms, Team and Inspect
   screens take no route params, and the Tasks screen only honours `taskId` for
   housekeepers. Until a screen can resolve a record AND enforce access, a target
   that names a record opens its parent screen — `recordDeepLink: false` records
   that, and `supervisorHref` never emits params a screen would ignore. */

export type SupervisorScreen = "rooms" | "team" | "inspect" | "tasks" | "notifications";

export interface SupervisorRouteDef {
  /** Expo Router pathname, relative to the `(app)` group's registered screens. */
  pathname: string;
  /** The screen file under `app/(app)/` that serves it. */
  screenFile: string;
  /** True once the screen resolves a specific record from route params for a supervisor. */
  recordDeepLink: boolean;
}

export const SUPERVISOR_ROUTES: Record<SupervisorScreen, SupervisorRouteDef> = {
  rooms: { pathname: "/(app)/room-board", screenFile: "room-board/index.tsx", recordDeepLink: false },
  team: { pathname: "/(app)/assignments", screenFile: "assignments/index.tsx", recordDeepLink: false },
  inspect: { pathname: "/(app)/inspect", screenFile: "inspect/index.tsx", recordDeepLink: false },
  tasks: { pathname: "/(app)/tasks", screenFile: "tasks/index.tsx", recordDeepLink: false },
  notifications: { pathname: "/(app)/notifications", screenFile: "notifications/index.tsx", recordDeepLink: false },
};

/** Screens a supervisor Today item must never open. */
export const HOUSEKEEPER_ONLY_PATH_PREFIXES: readonly string[] = ["/(app)/my-rooms", "/(app)/attention"];

export type SupervisorRecordType = "room" | "task" | "blocker" | "staff" | "notification";

export interface SupervisorTarget {
  screen: SupervisorScreen;
  /** The record the item is about, for the day a screen can open it directly. */
  record?: { type: SupervisorRecordType; id: string } | null;
}

export interface SupervisorHref {
  pathname: string;
}

/** The href for a target. Params are only emitted for screens that honour them (none yet). */
export function supervisorHref(target: SupervisorTarget): SupervisorHref {
  return { pathname: SUPERVISOR_ROUTES[target.screen].pathname };
}

/** True when `pathname` is a supervisor-safe destination (registered above, not housekeeper-only). */
export function isSupervisorSafePath(pathname: string): boolean {
  if (HOUSEKEEPER_ONLY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  return Object.values(SUPERVISOR_ROUTES).some((route) => route.pathname === pathname);
}
