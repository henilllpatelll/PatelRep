import type { AttentionReason } from "@/lib/housekeeping/myRoomsDashboard";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { Translate } from "@/lib/housekeeping/myRoomsText";

/**
 * "Finish your shift": what is true about the day right now, from the shared
 * HomeModel, plus the few real things worth a last look. Nothing here blocks
 * clock-out beyond what the server itself refuses (an open shift and a
 * connection): unfinished rooms and unsent work are shown, never invented
 * rules. A room left under DND, or with a work order open, is listed as a
 * handoff, not as unfinished work.
 */

export type ReviewItemKind =
  | "sync"
  | "unfinished"
  | "attention"
  | "exception"
  | "maintenance"
  | "tasks"
  | "lost_found";

export type ReviewTarget =
  | { type: "room"; roomId: string }
  | { type: "workOrder"; workOrderId: string }
  | { type: "sync" }
  | { type: "tasks" }
  | { type: "lostFound" };

export interface ReviewItem {
  /** One entry per room and kind; stable between renders. */
  id: string;
  kind: ReviewItemKind;
  roomId: string | null;
  roomNumber: string | null;
  /** The condition behind it: an attention code, "active"/"ready", "work_order", "sync_conflict"... */
  code: string;
  workOrderId: string | null;
  workOrderTitle: string | null;
  /** Tasks or items covered by the row (tasks, lost & found). */
  count: number;
  target: ReviewTarget;
}

export type ReviewWarning =
  | "board_unverified"
  | "active_room"
  | "rooms_remaining"
  | "pending_sync"
  | "sync_unverified"
  | "sync_problem";

export type ClockOutBlock = "offline" | "busy" | "not_open";

export interface ShiftReview {
  totals: {
    assigned: number;
    serviceable: number;
    completed: number;
    submitted: number;
    inspected: number;
    unavailable: number;
    /** Left through a documented exception (DND, declined, come back later). */
    exceptions: number;
    /** The room being cleaned right now (started, not yet submitted). */
    inProgress: number;
    /** Rooms that are ready to clean and not started. inProgress + notStarted === remaining. */
    notStarted: number;
  };
  /** Rooms still to clean, including the open one. */
  remaining: number;
  activeRoomNumber: string | null;
  sync: { pending: number; failed: number; conflicts: number; verified: boolean };
  items: ReviewItem[];
  warnings: ReviewWarning[];
  boardUsable: boolean;
  startedAt: string | null;
  breakSeconds: number;
  canClockOut: boolean;
  blockedBy: ClockOutBlock | null;
}

export interface ReviewExtras {
  /** Open tasks assigned to this person; null when it could not be read. */
  openTasks?: number | null;
  /** Lost & found items this person logged today. */
  foundToday?: number;
}

const ORDER: Record<ReviewItemKind, number> = {
  sync: 0,
  unfinished: 1,
  attention: 2,
  exception: 3,
  maintenance: 4,
  tasks: 5,
  lost_found: 6,
};

export function buildShiftReview(model: HomeModel, extras: ReviewExtras = {}): ShiftReview {
  const { progress, lifecycle, sync, dashboard, endOfShift } = model;
  const boardUsable = model.board.state === "ready" || model.board.state === "empty";
  const byKey = new Map<string, ReviewItem>();
  const add = (item: ReviewItem) => {
    if (!byKey.has(item.id)) byKey.set(item.id, item);
  };

  const woByRoom = new Map(endOfShift.handoffs.map((handoff) => [handoff.roomId, handoff]));

  if (boardUsable) {
    // Unfinished work: the open room (unless it is only waiting to send) and rooms still to start.
    for (const entry of dashboard.current) {
      if (entry.session?.state === "completing") continue;
      add({
        id: `unfinished:${entry.room.id}`,
        kind: "unfinished",
        roomId: entry.room.id,
        roomNumber: entry.room.room_number,
        code: "active",
        workOrderId: null,
        workOrderTitle: null,
        count: 1,
        target: { type: "room", roomId: entry.room.id },
      });
    }
    for (const entry of dashboard.upNext) {
      add({
        id: `unfinished:${entry.room.id}`,
        kind: "unfinished",
        roomId: entry.room.id,
        roomNumber: entry.room.room_number,
        code: "ready",
        workOrderId: null,
        workOrderTitle: null,
        count: 1,
        target: { type: "room", roomId: entry.room.id },
      });
    }

    // Rooms held back by something other than a documented exception.
    const exceptionRooms = new Set(endOfShift.exceptions.map((exception) => exception.roomId));
    for (const entry of dashboard.attention) {
      if (exceptionRooms.has(entry.room.id)) continue;
      const code = entry.attention ?? "note";
      if (code === "work_order") continue; // the maintenance handoff below already covers it
      add({
        id: `attention:${entry.room.id}`,
        kind: "attention",
        roomId: entry.room.id,
        roomNumber: entry.room.room_number,
        code,
        workOrderId: null,
        workOrderTitle: null,
        count: 1,
        target: { type: "room", roomId: entry.room.id },
      });
    }

    for (const exception of endOfShift.exceptions) {
      add({
        id: `exception:${exception.roomId}`,
        kind: "exception",
        roomId: exception.roomId,
        roomNumber: exception.roomNumber,
        code: exception.code,
        workOrderId: null,
        workOrderTitle: null,
        count: 1,
        target: { type: "room", roomId: exception.roomId },
      });
    }

    for (const handoff of woByRoom.values()) {
      add({
        id: `maintenance:${handoff.roomId}`,
        kind: "maintenance",
        roomId: handoff.roomId,
        roomNumber: handoff.roomNumber,
        code: "work_order",
        workOrderId: handoff.workOrderId,
        workOrderTitle: handoff.title,
        count: 1,
        target: { type: "workOrder", workOrderId: handoff.workOrderId },
      });
    }
  }

  // Changes the server did not accept, or work saved for a room that has since moved.
  for (const attention of model.attention) {
    if (attention.code !== "sync_conflict" && attention.code !== "sync_failed" && attention.code !== "session_unassigned") continue;
    add({
      id: `sync:${attention.id}`,
      kind: "sync",
      roomId: attention.roomId,
      roomNumber: attention.roomNumber ?? dashboard.all.find((entry) => entry.room.id === attention.roomId)?.room.room_number ?? null,
      code: attention.code,
      workOrderId: null,
      workOrderTitle: null,
      count: 1,
      target: { type: "sync" },
    });
  }

  if (extras.openTasks && extras.openTasks > 0) {
    add({
      id: "tasks",
      kind: "tasks",
      roomId: null,
      roomNumber: null,
      code: "open_tasks",
      workOrderId: null,
      workOrderTitle: null,
      count: extras.openTasks,
      target: { type: "tasks" },
    });
  }
  if (extras.foundToday && extras.foundToday > 0) {
    add({
      id: "lost_found",
      kind: "lost_found",
      roomId: null,
      roomNumber: null,
      code: "found_today",
      workOrderId: null,
      workOrderTitle: null,
      count: extras.foundToday,
      target: { type: "lostFound" },
    });
  }

  const items = [...byKey.values()]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => ORDER[a.item.kind] - ORDER[b.item.kind] || a.index - b.index)
    .map(({ item }) => item);

  const active = dashboard.current.find((entry) => entry.session?.state !== "completing");
  const remaining = boardUsable ? progress.actionRequired.active + progress.actionRequired.ready : 0;

  const warnings: ReviewWarning[] = [];
  if (!boardUsable) warnings.push("board_unverified");
  if (active) warnings.push("active_room");
  if (boardUsable && progress.actionRequired.ready > 0) warnings.push("rooms_remaining");
  if (sync.pending > 0) warnings.push("pending_sync");
  if (!sync.complete) warnings.push("sync_unverified");
  if (sync.failed > 0 || sync.conflicts > 0) warnings.push("sync_problem");

  let blockedBy: ClockOutBlock | null = null;
  if (lifecycle.state === "ended" || lifecycle.state === "not_started") blockedBy = "not_open";
  else if (!sync.online) blockedBy = "offline";
  else if (lifecycle.busy) blockedBy = "busy";
  else if (!lifecycle.canEnd) blockedBy = "not_open";

  return {
    totals: {
      assigned: progress.assigned,
      serviceable: progress.serviceable,
      completed: progress.completed,
      submitted: progress.submitted,
      inspected: progress.inspected,
      unavailable: progress.unavailable,
      exceptions: progress.handledExceptions,
      inProgress: boardUsable ? progress.actionRequired.active : 0,
      notStarted: boardUsable ? progress.actionRequired.ready : 0,
    },
    remaining,
    activeRoomNumber: active?.room.room_number ?? null,
    sync: { pending: sync.pending, failed: sync.failed, conflicts: sync.conflicts, verified: sync.complete },
    items,
    warnings,
    boardUsable,
    startedAt: lifecycle.startedAt,
    breakSeconds: lifecycle.breakSeconds,
    canClockOut: lifecycle.canEnd,
    blockedBy,
  };
}

/* ─── Wording ───────────────────────────────────────────────────────────────── */

const ROOM_TITLE_CODES: ReadonlySet<string> = new Set<AttentionReason | string>([
  "dnd",
  "do_not_service",
  "service_declined",
  "guest_inside",
  "access_problem",
  "checkout_unverified",
  "come_back_later",
  "reclean",
  "high_risk",
  "note",
]);

export interface ReviewItemCopy {
  /** "Room 214 · Maintenance" */
  title: string;
  /** "Open work order linked" */
  detail: string | null;
}

export function describeReviewItem(item: ReviewItem, t: Translate): ReviewItemCopy {
  const room = item.roomNumber;
  const withRoom = (label: string) => (room ? t("home.review.rowTitle", { room, label }) : label);

  switch (item.kind) {
    case "maintenance":
      return {
        title: withRoom(t("home.review.labels.maintenance")),
        detail: item.workOrderTitle ? t("home.review.details.maintenanceTitled", { title: item.workOrderTitle }) : t("home.review.details.maintenance"),
      };
    case "exception":
      return { title: withRoom(attentionLabel(item.code, t)), detail: t("home.review.details.exception") };
    case "attention":
      return { title: withRoom(attentionLabel(item.code, t)), detail: t("home.review.details.attention") };
    case "unfinished":
      return {
        title: withRoom(t(item.code === "active" ? "home.review.labels.inProgress" : "home.review.labels.toClean")),
        detail: t(item.code === "active" ? "home.review.details.inProgress" : "home.review.details.toClean"),
      };
    case "sync":
      return {
        title: withRoom(t(`home.attention.codes.${item.code}`)),
        detail: t(item.code === "sync_failed" ? "home.attention.syncFailed" : item.code === "session_unassigned" ? "home.attention.sessionUnassigned" : "home.attention.syncConflict"),
      };
    case "tasks":
      return { title: t("home.review.labels.tasks", { count: item.count }), detail: t("home.review.details.tasks") };
    case "lost_found":
      return { title: t("home.review.labels.lostFound", { count: item.count }), detail: t("home.review.details.lostFound") };
  }
}

function attentionLabel(code: string, t: Translate): string {
  return ROOM_TITLE_CODES.has(code) ? t(`rooms.dash.attention.${code}.title`) : t("home.review.labels.followUp");
}

/** "7h 25m", from whole seconds. */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
