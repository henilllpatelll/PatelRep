/* ─── Supervisor navigation contract ────────────────────────────────────────
   Where a supervisor Today item may send the user. Only routes that exist AND
   serve supervisors are listed. Supervisor actions never land in housekeeper-only
   screens (`my-rooms`, the housekeeper Attention Center).

   Only the Room Board resolves a record from route params (`roomId`): it looks the
   room up in its own, tenant-scoped board and says so when it is not there. Team
   and Inspect already open on the work an attention item points at (unassigned
   rooms first / the pending queue), and the Tasks screen only honours `taskId` for
   housekeepers. A target that names a record on a screen that cannot resolve it
   opens that screen — `recordDeepLink: false` records that, and `supervisorHref`
   never emits params a screen would ignore.

   `attention` is the supervisor Attention Center. It is a separate route from the
   housekeeper Attention Center (`/(app)/attention`), which stays untouched. */

export type SupervisorScreen = "rooms" | "team" | "inspect" | "tasks" | "notifications" | "attention";

export interface SupervisorRouteDef {
  /** Expo Router pathname, relative to the `(app)` group's registered screens. */
  pathname: string;
  /** The screen file under `app/(app)/` that serves it. */
  screenFile: string;
  /** True once the screen resolves a specific record from route params for a supervisor. */
  recordDeepLink: boolean;
}

export const SUPERVISOR_ROUTES: Record<SupervisorScreen, SupervisorRouteDef> = {
  rooms: { pathname: "/(app)/room-board", screenFile: "room-board/index.tsx", recordDeepLink: true },
  team: { pathname: "/(app)/assignments", screenFile: "assignments/index.tsx", recordDeepLink: false },
  inspect: { pathname: "/(app)/inspect", screenFile: "inspect/index.tsx", recordDeepLink: false },
  tasks: { pathname: "/(app)/tasks", screenFile: "tasks/index.tsx", recordDeepLink: false },
  notifications: { pathname: "/(app)/notifications", screenFile: "notifications/index.tsx", recordDeepLink: false },
  attention: { pathname: "/(app)/supervisor-attention", screenFile: "supervisor-attention/index.tsx", recordDeepLink: false },
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
  /** Present only when the destination resolves the record from it. */
  params?: Record<string, string>;
}

/**
 * The href for a target. Params are only emitted for screens that honour them, and only a room id
 * today. Backend authorization stays authoritative: the screen re-resolves the id as the signed-in user.
 */
export function supervisorHref(target: SupervisorTarget): SupervisorHref {
  const route = SUPERVISOR_ROUTES[target.screen];
  const record = target.record;
  if (route.recordDeepLink && target.screen === "rooms" && record?.type === "room" && record.id.trim()) {
    return { pathname: route.pathname, params: { roomId: record.id } };
  }
  return { pathname: route.pathname };
}

/** True when `pathname` is a supervisor-safe destination (registered above, not housekeeper-only). */
export function isSupervisorSafePath(pathname: string): boolean {
  if (HOUSEKEEPER_ONLY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  return Object.values(SUPERVISOR_ROUTES).some((route) => route.pathname === pathname);
}
