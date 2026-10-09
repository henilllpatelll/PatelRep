import type { Room } from "@/stores/appStore";

/**
 * What the Report / More sheet offers for one room, and why a row is unavailable.
 * Roles mirror the API: a row a role cannot use on the server is hidden here,
 * and a row that needs a connection says so instead of failing after the tap.
 */

export type ReportActionId = "exception" | "issue" | "supplies" | "found" | "note" | "info" | "linen" | "sync";

export type DisabledReason = "needsConnection" | "cleaningStarted" | "linenLocked";

export interface ReportActionState {
  id: ReportActionId;
  disabledReason: DisabledReason | null;
}

export interface ReportActionContext {
  role: string | null | undefined;
  isOnline: boolean;
  room: Pick<Room, "status">;
  /** A clean session is live for this room (the attendant is already inside). */
  hasLiveSession: boolean;
  /** The clean type tracks linen and a session exists to hold the counts. */
  linenApplicable: boolean;
  /** The clean is finished or waiting on the server; counts can no longer change. */
  linenLocked: boolean;
  /** Changes waiting to reach the server (queues + sessions). */
  pendingCount: number;
}

/** POST /rooms/{id}/service-attempts and /service-declined. */
const EXCEPTION_ROLES = new Set(["housekeeper", "housekeeping_supervisor", "gm", "chief_engineer"]);
/** POST /tasks. */
const SUPPLY_ROLES = new Set(["housekeeper", "housekeeping_supervisor", "gm", "front_desk", "engineer", "chief_engineer"]);
/** POST /lost-found. */
const FOUND_ROLES = new Set(["housekeeper", "housekeeping_supervisor", "gm", "front_desk"]);

/** Statuses where there is nothing left to report an access problem about. */
const NO_ACCESS_ISSUE = new Set<Room["status"]>(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

export function canReportException(role: string | null | undefined): boolean {
  return Boolean(role && EXCEPTION_ROLES.has(role));
}

export function getReportActions(ctx: ReportActionContext): ReportActionState[] {
  const { role, isOnline } = ctx;
  const out: ReportActionState[] = [];
  const offline: DisabledReason | null = isOnline ? null : "needsConnection";

  if (canReportException(role) && !NO_ACCESS_ISSUE.has(ctx.room.status)) {
    // Once the attendant is inside there is no "pre-entry" exception left to record.
    out.push({ id: "exception", disabledReason: ctx.hasLiveSession ? "cleaningStarted" : offline });
  }
  // Work orders keep their offline queue: no connection is needed to report.
  out.push({ id: "issue", disabledReason: null });
  if (role && SUPPLY_ROLES.has(role)) out.push({ id: "supplies", disabledReason: offline });
  if (role && FOUND_ROLES.has(role)) out.push({ id: "found", disabledReason: offline });
  out.push({ id: "note", disabledReason: offline });
  out.push({ id: "info", disabledReason: null });
  if (ctx.linenApplicable) out.push({ id: "linen", disabledReason: ctx.linenLocked ? "linenLocked" : null });
  if (ctx.pendingCount > 0 || !isOnline) out.push({ id: "sync", disabledReason: null });
  return out;
}
