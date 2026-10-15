import type { Room } from "@/stores/appStore";
import { isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { elapsedSeconds } from "@/lib/housekeeping/cleaningTimer";
import {
  buildDashboard,
  type AttentionReason,
  type CurrentSessionState,
  type DashboardModel,
  type RoomEntry,
  type SessionMap,
} from "@/lib/housekeeping/myRoomsDashboard";
import {
  buildRecommendation,
  whyNoRecommendation,
  type NoRecommendationReason,
  type Recommendation,
} from "@/lib/housekeeping/homeRecommendation";
import { buildSyncSummary, type SyncSummary } from "@/lib/housekeeping/homeSync";
import {
  boardIsWrongDay,
  resolveBoardDate,
  resolveBoardState,
  roomsForShiftDate,
  type BoardState,
  type Freshness,
} from "@/lib/housekeeping/roomsFreshness";
import type { ShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

/**
 * The housekeeper Home view model: one pure function from the same inputs My
 * Rooms uses (rooms + clean sessions) plus shift, freshness and sync state.
 * No React, no network, no AI — every operational fact on Home comes from here,
 * and the UI only renders it.
 */

/* ─── Progress ──────────────────────────────────────────────────────────────── */

/** Reasons where the person has done what they can and the room is waiting on the guest or front desk. */
const DOCUMENTED_EXCEPTIONS: ReadonlySet<AttentionReason> = new Set([
  "dnd",
  "do_not_service",
  "service_declined",
  "come_back_later",
]);

export function isDocumentedException(entry: RoomEntry): boolean {
  return entry.category === "attention" && entry.attention !== null && DOCUMENTED_EXCEPTIONS.has(entry.attention);
}

/**
 * Mutually exclusive: every assigned room is in exactly one bucket, so
 *   completed + handledExceptions + actionRequired.total + unavailable === assigned
 * Overlapping signals (rush, VIP, arrivals, pending sync...) live in `alerts`.
 */
export interface HomeProgress {
  assigned: number;
  /** Out of order / out of service: cannot be worked, never counted as cleaned. */
  unavailable: number;
  /** assigned − unavailable: the denominator for completion. */
  serviceable: number;

  /** Work completed: submitted for inspection or already inspected. */
  completed: number;
  /** Submitted clean, waiting for an inspector. */
  submitted: number;
  /** Passed inspection. Counted as complete; not claimed as cleaned by this person. */
  inspected: number;
  /** Completed rooms this device holds server-confirmed session evidence for. */
  confirmedByYou: number;

  /** Handled through documented exceptions (DND, declined service, come back later). */
  handledExceptions: number;

  /** Work still requiring action. */
  actionRequired: {
    total: number;
    /** Being cleaned right now. */
    active: number;
    /** Eligible to start. */
    ready: number;
    /** Restricted or needs follow-up that is not a documented exception. */
    attention: number;
  };
  /** Active + ready: remaining eligible cleaning work. */
  workable: number;
  /** Finished on this device, server confirmation still pending (not counted as completed). */
  awaitingConfirmation: number;

  /** completed / serviceable. Same number My Rooms shows. */
  percent: number;
  /** (completed + handledExceptions) / serviceable. */
  resolvedPercent: number;
}

/** Overlapping indicators — a room can appear in several. Never sum these. */
export interface HomeAlerts {
  rush: number;
  rushOverdue: number;
  reclean: number;
  dnd: number;
  serviceDeclined: number;
  arrivalsSoon: number;
  vip: number;
  openWorkOrders: number;
  pendingSync: number;
  failedSync: number;
  conflicts: number;
}

function buildProgress(dashboard: DashboardModel, sessions: SessionMap): HomeProgress {
  const p = dashboard.progress;
  const exceptions = dashboard.attention.filter(isDocumentedException).length;
  const openAttention = dashboard.attention.length - exceptions;
  const completedEntries = [...dashboard.submitted, ...dashboard.inspected];
  const serviceable = p.serviceable;
  return {
    assigned: p.assigned,
    unavailable: p.unavailable,
    serviceable,
    completed: p.completed,
    submitted: p.submitted,
    inspected: p.inspected,
    confirmedByYou: completedEntries.filter((e) => sessions[e.room.id]?.completionConfirmed).length,
    handledExceptions: exceptions,
    actionRequired: {
      total: p.current + p.upNext + openAttention,
      active: p.current,
      ready: p.upNext,
      attention: openAttention,
    },
    workable: p.workable,
    awaitingConfirmation: dashboard.current.filter((e) => e.session?.state === "completing").length,
    percent: p.percent,
    resolvedPercent: serviceable > 0 ? Math.round(((p.completed + exceptions) / serviceable) * 100) : 0,
  };
}

function buildAlerts(dashboard: DashboardModel, sync: SyncSummary, now: Date): HomeAlerts {
  const open = [...dashboard.current, ...dashboard.upNext, ...dashboard.attention];
  return {
    rush: open.filter((e) => e.rush).length,
    rushOverdue: open.filter((e) => e.rush?.overdue).length,
    reclean: open.filter((e) => e.classification.reclean).length,
    dnd: open.filter((e) => e.room.dnd_flag).length,
    serviceDeclined: open.filter((e) => e.attention === "service_declined" || e.attention === "do_not_service").length,
    arrivalsSoon: open.filter((e) => isArrivalSoon(e.room, now)).length,
    vip: open.filter((e) => e.room.vip_flag).length,
    openWorkOrders: open.filter((e) => e.room.open_work_order_id).length,
    pendingSync: sync.pending,
    failedSync: sync.failed,
    conflicts: sync.conflicts,
  };
}

/* ─── Active room ───────────────────────────────────────────────────────────── */

export interface ActiveRoomView {
  room: Room;
  entry: RoomEntry;
  sessionState: CurrentSessionState;
  /** Authoritative clean-session start. Null when unknown — the UI must not show a timer then. */
  startedAt: string | null;
  /** The server confirmed the start (false while it exists only on this device). */
  startedAtVerified: boolean;
  elapsedSeconds: number | null;
  estimateMinutes: number;
  checklistDone: number;
  checklistTotal: number;
  /** Local changes the server has not confirmed. */
  pendingSync: boolean;
  /** Finished on this device, awaiting the server. */
  completing: boolean;
}

function buildActiveRoom(dashboard: DashboardModel, now: Date): ActiveRoomView | null {
  const entry = dashboard.current[0];
  if (!entry?.session) return null;
  const session = entry.session;
  const known = session.state !== "missing";
  const startedAt = known ? session.startedAt : null;
  return {
    room: entry.room,
    entry,
    sessionState: session.state,
    startedAt,
    startedAtVerified: known && session.state !== "starting",
    elapsedSeconds: elapsedSeconds(startedAt, now.getTime()),
    estimateMinutes: entry.estimateMinutes,
    checklistDone: session.checklistDone,
    checklistTotal: session.checklistTotal,
    pendingSync: session.pendingSync,
    completing: session.state === "completing",
  };
}

/* ─── Recent submission ─────────────────────────────────────────────────────── */

/** How long after finishing a room Home keeps saying so. */
export const RECENT_SUBMISSION_WINDOW_MS = 10 * 60_000;

export interface RecentSubmission {
  roomId: string;
  roomNumber: string;
  /** When the room was finished (server time once confirmed, device time before). */
  at: string;
  /** The server confirmed the completion. False = saved on this device, still to send. */
  confirmed: boolean;
  /** An inspector has since passed it. Distinct from the housekeeper's own submission. */
  inspected: boolean;
}

/**
 * The room this person finished most recently, if it was just now. Only rooms
 * with a local clean session count: a room that merely shows CLEAN on the board
 * was not necessarily finished by this person.
 */
function buildRecentSubmission(dashboard: DashboardModel, sessions: SessionMap, now: Date): RecentSubmission | null {
  let best: { submission: RecentSubmission; ms: number } | null = null;
  for (const entry of dashboard.all) {
    const session = sessions[entry.room.id];
    if (!session) continue;
    const confirmed = session.completionConfirmed;
    const at = confirmed ? (session.endedAt ?? session.completeRequestedAt) : session.completeRequestedAt;
    if (!at) continue;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || now.getTime() - ms > RECENT_SUBMISSION_WINDOW_MS) continue;
    if (best && ms <= best.ms) continue;
    best = {
      ms,
      submission: {
        roomId: entry.room.id,
        roomNumber: entry.room.room_number,
        at,
        confirmed,
        inspected: confirmed && entry.category === "inspected",
      },
    };
  }
  return best?.submission ?? null;
}

/* ─── Attention items ───────────────────────────────────────────────────────── */

export type AttentionKind =
  | "room"
  | "supervisor_message"
  | "sync_conflict"
  | "sync_failed"
  | "session_missing"
  | "session_unassigned";

export type AttentionCode =
  | AttentionReason
  | "rush_overdue"
  | "supervisor_message"
  | "sync_conflict"
  | "sync_failed"
  | "session_missing"
  | "session_unassigned";

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionDestination =
  | { route: "room"; roomId: string }
  | { route: "notification"; notificationId: string }
  | { route: "my_rooms" }
  | { route: "sync" };

export interface AttentionItem {
  /** Stable across refreshes: the same condition on the same record keeps the same id. */
  id: string;
  kind: AttentionKind;
  code: AttentionCode;
  /** Other reasons the same room carries, strongest first (excluding `code`). */
  alsoCodes: AttentionCode[];
  severity: AttentionSeverity;
  roomId: string | null;
  roomNumber: string | null;
  /** The record behind it: notification id, session id, queue row key. */
  recordId: string | null;
  /** A time that matters for it (DND retry, rush deadline). */
  at: string | null;
  destination: AttentionDestination;
}

const CODE_SEVERITY: Record<AttentionCode, AttentionSeverity> = {
  sync_conflict: "critical",
  sync_failed: "critical",
  session_unassigned: "critical",
  rush_overdue: "critical",
  guest_inside: "warning",
  access_problem: "warning",
  checkout_unverified: "warning",
  high_risk: "warning",
  work_order: "warning",
  reclean: "warning",
  session_missing: "warning",
  supervisor_message: "info",
  dnd: "info",
  do_not_service: "info",
  service_declined: "info",
  come_back_later: "info",
  note: "info",
};
const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export interface SupervisorNoteInput {
  id: string;
  title: string;
  body: string;
  createdAt?: string | null;
  /** The notification row's own type and payload; links are resolved from these, never from the wording. */
  type?: string;
  data?: Record<string, unknown> | null;
}

export interface SupervisorInstruction {
  id: string;
  title: string;
  body: string;
  createdAt: string | null;
  type: string | null;
  data: Record<string, unknown> | null;
  destination: AttentionDestination;
}

function roomItem(entry: RoomEntry, code: AttentionCode, also: AttentionCode[], at: string | null): AttentionItem {
  return {
    id: `room:${entry.room.id}:${code}`,
    kind: "room",
    code,
    alsoCodes: also.filter((c) => c !== code),
    severity: CODE_SEVERITY[code],
    roomId: entry.room.id,
    roomNumber: entry.room.room_number,
    recordId: entry.room.assignment_id ?? null,
    at,
    destination: { route: "room", roomId: entry.room.id },
  };
}

function buildAttentionItems(input: {
  dashboard: DashboardModel;
  sessions: SessionMap;
  note: SupervisorInstruction | null;
  sync: SyncSummary;
}): AttentionItem[] {
  const { dashboard, sessions, note, sync } = input;
  const items: AttentionItem[] = [];
  const assigned = new Set(dashboard.all.map((e) => e.room.id));

  // A session this device still holds for a room that is no longer on the board
  // (reassigned, or the list changed): unsent work must not vanish silently.
  for (const [roomId, session] of Object.entries(sessions)) {
    if (!session || session.completionConfirmed || assigned.has(roomId)) continue;
    items.push({
      id: `session:${session.sessionId}:unassigned`,
      kind: "session_unassigned",
      code: "session_unassigned",
      alsoCodes: [],
      severity: "critical",
      roomId,
      roomNumber: null,
      recordId: session.sessionId,
      at: null,
      destination: { route: "room", roomId },
    });
  }

  for (const entry of dashboard.attention) {
    const code = entry.attention ?? "note";
    const at = code === "dnd" || code === "come_back_later" ? entry.room.dnd_retry_at ?? null : null;
    items.push(roomItem(entry, code, entry.classification.reasons, at));
  }

  for (const entry of [...dashboard.current, ...dashboard.upNext]) {
    if (entry.classification.reclean) items.push(roomItem(entry, "reclean", [], entry.classification.reclean.requestedAt));
    if (entry.rush?.overdue) items.push(roomItem(entry, "rush_overdue", [], entry.neededBy));
    if (entry.session?.state === "missing") {
      items.push({
        ...roomItem(entry, "session_missing", [], null),
        kind: "session_missing",
      });
    }
  }

  for (const row of sync.rows) {
    if (row.state !== "conflict" && row.state !== "failed") continue;
    const code: AttentionCode = row.state === "conflict" ? "sync_conflict" : "sync_failed";
    items.push({
      id: `sync:${row.key}`,
      kind: code,
      code,
      alsoCodes: [],
      severity: "critical",
      roomId: row.roomId,
      roomNumber: null,
      recordId: row.key,
      at: null,
      destination: row.roomId ? { route: "room", roomId: row.roomId } : { route: "sync" },
    });
  }

  if (note) {
    items.push({
      id: `message:${note.id}`,
      kind: "supervisor_message",
      code: "supervisor_message",
      alsoCodes: [],
      severity: "info",
      roomId: null,
      roomNumber: null,
      recordId: note.id,
      at: note.createdAt,
      destination: note.destination,
    });
  }

  // Severity first; within it, the order the items were found (rooms already follow the dashboard's precedence).
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

/* ─── End of shift ──────────────────────────────────────────────────────────── */

export type EndOfShiftBlockerCode =
  | "board_unavailable"
  | "active_room"
  | "rooms_remaining"
  | "attention_open"
  | "pending_sync"
  | "sync_failed"
  | "sync_conflict";

export interface EndOfShiftBlocker {
  code: EndOfShiftBlockerCode;
  count: number;
}

export interface EndOfShiftReadiness {
  /** Nothing is left to do or to send. Clock-out is still the person's choice either way. */
  ready: boolean;
  blockers: EndOfShiftBlocker[];
  /** Rooms left through documented exceptions: not blockers, but worth a handoff note. */
  exceptions: Array<{ roomId: string; roomNumber: string; code: AttentionReason }>;
  /** Rooms with an open work order for the next shift. */
  handoffs: Array<{ roomId: string; roomNumber: string; workOrderId: string; title: string | null }>;
  completed: number;
}

function buildEndOfShift(input: {
  dashboard: DashboardModel;
  progress: HomeProgress;
  board: BoardState;
  sync: SyncSummary;
  rooms: Room[];
}): EndOfShiftReadiness {
  const { dashboard, progress, board, sync, rooms } = input;
  const blockers: EndOfShiftBlocker[] = [];
  const add = (code: EndOfShiftBlockerCode, count: number) => {
    if (count > 0) blockers.push({ code, count });
  };
  // Without a trustworthy board, "nothing left" is a guess.
  add("board_unavailable", board === "unavailable" || board === "stale_date" ? 1 : 0);
  add("active_room", progress.actionRequired.active);
  add("rooms_remaining", progress.actionRequired.ready);
  add("attention_open", progress.actionRequired.attention);
  add("pending_sync", sync.pending + (sync.complete ? 0 : 1));
  add("sync_failed", sync.failed);
  add("sync_conflict", sync.conflicts);

  return {
    ready: blockers.length === 0 && (board === "ready" || board === "empty"),
    blockers,
    exceptions: dashboard.attention.filter(isDocumentedException).map((e) => ({
      roomId: e.room.id,
      roomNumber: e.room.room_number,
      code: e.attention as AttentionReason,
    })),
    handoffs: rooms
      .filter((room) => room.open_work_order_id)
      .map((room) => ({
        roomId: room.id,
        roomNumber: room.room_number,
        workOrderId: room.open_work_order_id as string,
        title: room.open_work_order_title ?? null,
      })),
    completed: progress.completed,
  };
}

/* ─── Model ─────────────────────────────────────────────────────────────────── */

export interface HomeBoardInput {
  loading: boolean;
  refreshing: boolean;
  /** The latest request succeeded and the server said there are no assignments. */
  confirmedEmpty: boolean;
  freshness: Freshness;
  fetchError: string | null;
  usingCache: boolean;
  /** ms epoch of the last authoritative refresh. */
  lastRefreshAt: number | null;
  /** Shift date the server resolved for the last answer (it may differ from the calendar date it was asked for). */
  serverShiftDate: string | null;
  /** The calendar date the last answer was requested for; null when no server answer is current. */
  answeredForDate: string | null;
}

export interface HomeModelInput {
  rooms: Room[];
  sessions: SessionMap;
  /** The clock rooms are classified and ranked at (stable between deliberate refreshes). */
  rankedAt: Date;
  /** Wall clock, for elapsed timers. */
  now: Date;
  /** The hotel's current shift date. */
  expectedShiftDate: string;
  timeZone: string | null;
  isOnline: boolean;
  board: HomeBoardInput;
  lifecycle: ShiftLifecycle;
  syncRows: SyncRow[];
  syncRowsComplete: boolean;
  supervisorNote: SupervisorNoteInput | null;
}

export interface HomeModel {
  shiftDate: string;
  timeZone: string | null;
  lifecycle: ShiftLifecycle;
  board: {
    state: BoardState;
    freshness: Freshness;
    refreshing: boolean;
    fetchError: string | null;
    usingCache: boolean;
    lastRefreshAt: string | null;
  };
  progress: HomeProgress;
  alerts: HomeAlerts;
  activeRoom: ActiveRoomView | null;
  recommendation: Recommendation | null;
  /**
   * The next room to start, ignoring a room that is only waiting to send its
   * completion (it is done as far as the person is concerned). Equals
   * `recommendation` unless the active room is "completing".
   */
  nextRoom: Recommendation | null;
  /** A room finished in the last few minutes. */
  recentSubmission: RecentSubmission | null;
  /** Why there is nothing to recommend, when there isn't. */
  noRecommendation: NoRecommendationReason | null;
  attention: AttentionItem[];
  supervisorInstruction: SupervisorInstruction | null;
  sync: SyncSummary;
  endOfShift: EndOfShiftReadiness;
  /** The My Rooms model Home was derived from (same object My Rooms would build). */
  dashboard: DashboardModel;
}

export function buildHomeModel(input: HomeModelInput): HomeModel {
  const { rooms, sessions, rankedAt, now, expectedShiftDate, board: boardInput, lifecycle } = input;

  const { serverShiftDate, answeredForDate } = boardInput;
  const boardDate = resolveBoardDate(expectedShiftDate, serverShiftDate, answeredForDate);
  const wrongDay = boardIsWrongDay(rooms, expectedShiftDate, serverShiftDate, answeredForDate);
  // Another day's assignments are never today's work.
  const scoped = wrongDay ? [] : roomsForShiftDate(rooms, boardDate);
  const boardState = resolveBoardState({
    loading: boardInput.loading,
    roomCount: scoped.length,
    wrongDay,
    confirmedEmpty: boardInput.confirmedEmpty,
  });

  const dashboard = buildDashboard(scoped, sessions, rankedAt);
  const sync = buildSyncSummary({
    isOnline: input.isOnline,
    freshness: boardInput.freshness,
    lastRefreshAt: boardInput.lastRefreshAt,
    fetchFailed: boardInput.fetchError !== null,
    rows: input.syncRows,
    rowsComplete: input.syncRowsComplete,
  });

  const progress = buildProgress(dashboard, sessions);
  const recommendation = buildRecommendation(dashboard, rankedAt);
  const hasCompleting = dashboard.current.some((e) => e.session?.state === "completing");
  const nextRoom = hasCompleting
    ? buildRecommendation({ ...dashboard, current: dashboard.current.filter((e) => e.session?.state !== "completing") }, rankedAt)
    : recommendation;
  const note = input.supervisorNote
    ? {
        id: input.supervisorNote.id,
        title: input.supervisorNote.title,
        body: input.supervisorNote.body,
        createdAt: input.supervisorNote.createdAt ?? null,
        type: input.supervisorNote.type ?? null,
        data: input.supervisorNote.data ?? null,
        destination: { route: "notification", notificationId: input.supervisorNote.id } as const,
      }
    : null;

  return {
    shiftDate: boardDate,
    timeZone: input.timeZone,
    lifecycle,
    board: {
      state: boardState,
      freshness: boardInput.freshness,
      refreshing: boardInput.refreshing,
      fetchError: boardInput.fetchError,
      usingCache: boardInput.usingCache,
      lastRefreshAt: sync.lastRefreshAt,
    },
    progress,
    alerts: buildAlerts(dashboard, sync, rankedAt),
    activeRoom: buildActiveRoom(dashboard, now),
    recommendation,
    nextRoom,
    recentSubmission: buildRecentSubmission(dashboard, sessions, now),
    noRecommendation: recommendation ? null : whyNoRecommendation(dashboard, boardState === "ready" || boardState === "empty"),
    attention: buildAttentionItems({ dashboard, sessions, note, sync }),
    supervisorInstruction: note,
    sync,
    endOfShift: buildEndOfShift({ dashboard, progress, board: boardState, sync, rooms: scoped }),
    dashboard,
  };
}
