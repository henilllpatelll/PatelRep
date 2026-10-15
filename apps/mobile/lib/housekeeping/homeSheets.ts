import type { Room } from "@/stores/appStore";
import type { AttentionItem, HomeModel } from "@/lib/housekeeping/homeModel";
import type { Recommendation } from "@/lib/housekeeping/homeRecommendation";
import { leadOf } from "@/lib/housekeeping/homeState";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import { getReportActions, type DisabledReason } from "@/lib/housekeeping/reportActions";

/**
 * Pure resolvers behind the Home drawers. Each takes the live HomeModel plus the
 * id the drawer was opened for and answers "what is true right now": a drawer
 * re-resolves on every render, so a reassignment or a status change while it is
 * open can never leave it acting on a stale room.
 */

/* ─── Room actions ──────────────────────────────────────────────────────────── */

/** Opens a screen or sheet; sends nothing by itself. */
export type RoomNavigateAction = "open" | "info";
/** Opens the existing form on the room screen; nothing is sent until it is submitted there. */
export type RoomFormAction = "note" | "issue" | "supplies" | "exception";
export type RoomActionId = RoomNavigateAction | RoomFormAction;

export interface RoomActionRow {
  id: RoomActionId;
  kind: "navigate" | "form";
  disabledReason: DisabledReason | null;
}

export type RoomActionsView =
  /** The room is no longer on this person's list (reassigned, or the day changed). */
  | { state: "missing" }
  | {
      state: "ready";
      entry: RoomEntry;
      room: Room;
      /** Entry is restricted right now: the drawer never offers to continue cleaning. */
      restricted: boolean;
      /** "Continue cleaning" only for an open session on an enterable room; otherwise "Open room". */
      continuing: boolean;
      actions: RoomActionRow[];
    };

const FORM_ORDER: RoomFormAction[] = ["note", "issue", "supplies", "exception"];

export function findRoomEntry(model: HomeModel, roomId: string | null | undefined): RoomEntry | null {
  if (!roomId) return null;
  return model.dashboard.all.find((entry) => entry.room.id === roomId) ?? null;
}

export function resolveRoomActions(input: {
  model: HomeModel;
  roomId: string | null;
  role: string | null | undefined;
  isOnline: boolean;
  pendingCount: number;
}): RoomActionsView {
  const { model, roomId, role, isOnline, pendingCount } = input;
  const entry = findRoomEntry(model, roomId);
  if (!entry) return { state: "missing" };

  const room = entry.room;
  const restricted = entry.classification.restricted;
  const hasLiveSession = entry.category === "current" && entry.session?.state !== "missing";
  const available = getReportActions({
    role,
    isOnline,
    room,
    hasLiveSession,
    linenApplicable: false,
    linenLocked: false,
    pendingCount,
  });

  const actions: RoomActionRow[] = [{ id: "open", kind: "navigate", disabledReason: null }];
  for (const id of FORM_ORDER) {
    const found = available.find((candidate) => candidate.id === id);
    if (found) actions.push({ id, kind: "form", disabledReason: found.disabledReason });
  }
  actions.push({ id: "info", kind: "navigate", disabledReason: null });

  return {
    state: "ready",
    entry,
    room,
    restricted,
    continuing: entry.category === "current" && !restricted,
    actions,
  };
}

/* ─── Why this room ─────────────────────────────────────────────────────────── */

export type WhyRoomView =
  | { state: "ready"; recommendation: Recommendation; changed: boolean }
  | { state: "none" };

/**
 * The explanation always describes the CURRENT lead room. If the ranking moved
 * since the drawer opened, `changed` is true and the primary action opens the
 * new room (named on the button), never the one the person first saw.
 */
export function resolveWhyRoom(model: HomeModel, openedRoomId: string | null): WhyRoomView {
  const recommendation = leadOf(model);
  if (!recommendation) return { state: "none" };
  return { state: "ready", recommendation, changed: openedRoomId !== null && recommendation.room.id !== openedRoomId };
}

/* ─── Issue details ─────────────────────────────────────────────────────────── */

export type IssueKind =
  | "dnd"
  | "declined"
  | "come_back_later"
  | "guest_inside"
  | "access"
  | "checkout"
  | "maintenance"
  | "reclean"
  | "rush"
  | "session"
  | "sync"
  | "other";

export function issueKindOf(code: AttentionItem["code"]): IssueKind {
  switch (code) {
    case "dnd":
      return "dnd";
    case "do_not_service":
    case "service_declined":
      return "declined";
    case "come_back_later":
      return "come_back_later";
    case "guest_inside":
      return "guest_inside";
    case "access_problem":
      return "access";
    case "checkout_unverified":
      return "checkout";
    case "work_order":
      return "maintenance";
    case "reclean":
      return "reclean";
    case "rush_overdue":
      return "rush";
    case "session_missing":
    case "session_unassigned":
      return "session";
    case "sync_conflict":
    case "sync_failed":
      return "sync";
    default:
      return "other";
  }
}

/** Conditions where entering is not the housekeeper's call: the drawer never offers Start, and cannot clear them. */
const RESTRICTED_KINDS: ReadonlySet<IssueKind> = new Set(["dnd", "declined", "come_back_later", "guest_inside"]);

export type IssueDetailsView =
  /** The condition cleared (or the room moved) since the drawer opened. */
  | { state: "resolved" }
  | {
      state: "ready";
      item: AttentionItem;
      kind: IssueKind;
      entry: RoomEntry | null;
      /** The person has to wait; there is deliberately no way to override from here. */
      restricted: boolean;
      /** "Add note" (the existing room-note form). Null when this person cannot add one; a reason when it is temporarily unavailable. */
      noteAction: { disabledReason: DisabledReason | null } | null;
      /** "View room" is offered: the room is on this person's list. */
      canViewRoom: boolean;
    };

export function resolveIssueDetails(input: {
  model: HomeModel;
  itemId: string | null;
  role: string | null | undefined;
  isOnline: boolean;
}): IssueDetailsView {
  const { model, itemId, role, isOnline } = input;
  const item = itemId ? model.attention.find((candidate) => candidate.id === itemId) : undefined;
  if (!item) return { state: "resolved" };
  const entry = findRoomEntry(model, item.roomId);
  const kind = issueKindOf(item.code);
  const note = entry
    ? getReportActions({ role, isOnline, room: entry.room, hasLiveSession: false, linenApplicable: false, linenLocked: false, pendingCount: 0 }).find(
        (action) => action.id === "note",
      )
    : undefined;
  return {
    state: "ready",
    item,
    kind,
    entry,
    restricted: RESTRICTED_KINDS.has(kind) || Boolean(entry?.classification.restricted),
    noteAction: note ? { disabledReason: note.disabledReason } : null,
    canViewRoom: entry !== null,
  };
}

/* ─── Shift progress ────────────────────────────────────────────────────────── */

export interface ProgressDetails {
  assigned: number;
  serviceable: number;
  /** Mutually exclusive: these five add up to `assigned`. */
  completed: number;
  toClean: number;
  inProgress: number;
  needsAttention: number;
  unavailable: number;
  /** Parts of `completed`. */
  submitted: number;
  inspected: number;
  /** Subset of `inProgress`: finished on this phone, not yet confirmed by the server (never counted as completed). */
  awaitingConfirmation: number;
  /** completed + toClean + inProgress + needsAttention + unavailable === assigned. */
  reconciles: boolean;
  /** Overlapping flags. A room can carry several, so they are never summed or compared with the totals. */
  flags: { rush: number; reclean: number; arrivalsSoon: number };
}

export function buildProgressDetails(model: HomeModel): ProgressDetails {
  const p = model.progress;
  const toClean = p.actionRequired.ready;
  const inProgress = p.actionRequired.active;
  const needsAttention = p.actionRequired.attention + p.handledExceptions;
  return {
    assigned: p.assigned,
    serviceable: p.serviceable,
    completed: p.completed,
    toClean,
    inProgress,
    needsAttention,
    unavailable: p.unavailable,
    submitted: p.submitted,
    inspected: p.inspected,
    awaitingConfirmation: p.awaitingConfirmation,
    reconciles: p.completed + toClean + inProgress + needsAttention + p.unavailable === p.assigned,
    flags: { rush: model.alerts.rush, reclean: model.alerts.reclean, arrivalsSoon: model.alerts.arrivalsSoon },
  };
}
