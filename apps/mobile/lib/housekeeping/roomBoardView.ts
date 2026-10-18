import { formatHotelTime, hotelDateKey } from "@/lib/housekeeping/hotelTime";
import type { BoardRoom, RoomStage } from "@/lib/housekeeping/roomBoardModel";
import {
  buildBoardMetrics,
  findUrgentRooms,
  groupByBuildingAndFloor,
  isUnassignedWork,
  roomIndicators,
  type BoardMetrics,
  type BuildingGroupOf,
} from "@/lib/housekeeping/roomBoardSelectors";
import type { BoardAvailability, BoardRoomView } from "@/lib/housekeeping/roomBoardState";

/* ─── Room Board — view layer (pure) ────────────────────────────────────────
   Everything the redesigned main board shows, derived from the verified `BoardRoomView`s and the Phase 1
   selectors. No React, no I/O, no fetching. Strings are produced through a caller-supplied `translate`
   so the rules here (what is shown, in what order, what is omitted) are unit-testable in one place.

   Nothing is invented: a detail with no recorded fact behind it is omitted, never filled in. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Status segments ─────────────────────────────────────────────────────── */

export type BoardSegmentKey = "all" | "toClean" | "working" | "toInspect" | "ready";

export const BOARD_SEGMENTS: readonly BoardSegmentKey[] = ["all", "toClean", "working", "toInspect", "ready"];

/** The stages a segment shows. `all` is null: every room, out-of-service and unrecognised statuses included. */
const SEGMENT_STAGES: Record<Exclude<BoardSegmentKey, "all">, RoomStage> = {
  toClean: "to_clean",
  working: "in_progress",
  toInspect: "awaiting_inspection",
  ready: "guest_ready",
};

export function inSegment(stage: RoomStage, segment: BoardSegmentKey): boolean {
  return segment === "all" || SEGMENT_STAGES[segment] === stage;
}

export function segmentCounts(metrics: BoardMetrics): Record<BoardSegmentKey, number> {
  return {
    all: metrics.inventory,
    toClean: metrics.toClean,
    working: metrics.inProgress,
    toInspect: metrics.awaitingInspection,
    ready: metrics.guestReady,
  };
}

/* ─── Attention signals ───────────────────────────────────────────────────── */

export type AttentionKey = "unassigned" | "urgent" | "dnd" | "vip";

export interface AttentionSignal {
  key: AttentionKey;
  count: number;
}

/**
 * Only substantiated, non-zero signals, in a fixed order. "Urgent" is the Phase 1 rule (a recorded reclean
 * request, a passed arrival, a VIP not ready, an elevated stored priority or a stored HIGH risk) — never a guess.
 */
export function buildAttentionSignals(
  views: readonly BoardRoomView[],
  metrics: BoardMetrics,
  now: number,
  timeZone: string | null | undefined,
): AttentionSignal[] {
  const urgent = findUrgentRooms(views, now, timeZone).length;
  const signals: AttentionSignal[] = [
    { key: "unassigned", count: metrics.unassigned },
    { key: "urgent", count: urgent },
    { key: "dnd", count: metrics.dnd },
    { key: "vip", count: metrics.vip },
  ];
  return signals.filter((signal) => signal.count > 0);
}

/* ─── Grouping and the flat list ──────────────────────────────────────────── */

export type BoardGroups = BuildingGroupOf<BoardRoomView>[];

export function groupBoard(views: readonly BoardRoomView[]): BoardGroups {
  return groupByBuildingAndFloor(views);
}

export type BoardListItem =
  | { type: "building"; key: string; building: string | null }
  | { type: "floor"; key: string; floor: number | null; shown: number; total: number }
  | { type: "row"; key: string; views: BoardRoomView[]; columns: number };

/**
 * Buildings → floors → rows of `columns` rooms, flattened for a virtualised list. A building heading appears
 * only when the hotel has more than one building group. Floors with nothing in the segment are dropped;
 * `total` is the floor's full count so a filtered floor reads "3 of 24".
 */
export function flattenBoard(groups: BoardGroups, segment: BoardSegmentKey, columns: number): BoardListItem[] {
  const perRow = Math.max(1, Math.floor(columns));
  const showBuildings = groups.length > 1;
  const items: BoardListItem[] = [];
  for (const group of groups) {
    const floors = group.floors
      .map((floor) => ({ floor, shown: floor.rooms.filter((view) => inSegment(view.room.statusInfo.stage, segment)) }))
      .filter((entry) => entry.shown.length > 0);
    if (floors.length === 0) continue;
    const buildingKey = group.building ?? "~";
    if (showBuildings) items.push({ type: "building", key: `b:${buildingKey}`, building: group.building });
    for (const { floor, shown } of floors) {
      const floorKey = `f:${buildingKey}:${floor.floor ?? "~"}`;
      items.push({ type: "floor", key: floorKey, floor: floor.floor, shown: shown.length, total: floor.rooms.length });
      for (let index = 0; index < shown.length; index += perRow) {
        items.push({ type: "row", key: `${floorKey}:r${index / perRow}`, views: shown.slice(index, index + perRow), columns: perRow });
      }
    }
  }
  return items;
}

/* ─── Responsive grid ─────────────────────────────────────────────────────── */

export const GRID_GUTTER = 16;
export const GRID_GAP = 8;
const MIN_TILE_WIDTH = 140;
const MAX_COLUMNS = 6;

/**
 * How many room cards fit a row. Text scales the card's minimum width, so a large-font user gets fewer, wider
 * cards instead of clipped numbers: 2 columns on ordinary phones, 1 on very narrow or large-text setups, more on tablets.
 */
export function gridColumns(width: number, fontScale: number): number {
  if (!Number.isFinite(width) || width <= 0) return 2;
  const scale = Math.min(1.5, Math.max(1, Number.isFinite(fontScale) ? fontScale : 1));
  const minTile = MIN_TILE_WIDTH * scale;
  const fit = Math.floor((width - GRID_GUTTER * 2 + GRID_GAP) / (minTile + GRID_GAP));
  return Math.min(MAX_COLUMNS, Math.max(1, fit));
}

/* ─── Header status line ──────────────────────────────────────────────────── */

export type BoardStatusLine =
  | { kind: "loading" }
  | { kind: "updating" }
  | { kind: "live"; ageMs: number }
  | { kind: "stale"; verifiedAt: number }
  | { kind: "offline"; verifiedAt: number | null }
  | { kind: "previous_day" }
  | { kind: "unavailable" };

/** What the header may claim. "Live" is only ever a board the server verified recently and that is not mid-refresh. */
export function describeBoardStatus(
  availability: BoardAvailability,
  options: { refreshing: boolean; isOnline: boolean; now: number },
): BoardStatusLine {
  const { refreshing, isOnline, now } = options;
  switch (availability.kind) {
    case "loading":
      return { kind: "loading" };
    case "unavailable":
      return availability.cause === "offline" ? { kind: "offline", verifiedAt: null } : { kind: "unavailable" };
    case "previous_day":
      return refreshing ? { kind: "updating" } : { kind: "previous_day" };
    case "stale":
      if (refreshing) return { kind: "updating" };
      return availability.reason === "offline" || !isOnline
        ? { kind: "offline", verifiedAt: availability.verifiedAt }
        : { kind: "stale", verifiedAt: availability.verifiedAt };
    case "ready":
    case "verified_empty":
      if (!isOnline) return { kind: "offline", verifiedAt: availability.verifiedAt };
      if (refreshing) return { kind: "updating" };
      return { kind: "live", ageMs: Math.max(0, now - availability.verifiedAt) };
  }
}

export type AgeText = { unit: "now" } | { unit: "seconds" | "minutes"; value: number };

/** Under 5 s "just now", then seconds, then minutes. Past an hour the clock time is clearer than "97 minutes ago". */
export function describeAge(ageMs: number): AgeText | null {
  const seconds = Math.floor(Math.max(0, ageMs) / 1000);
  if (seconds < 5) return { unit: "now" };
  if (seconds < 60) return { unit: "seconds", value: seconds };
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? { unit: "minutes", value: minutes } : null;
}

/* ─── Room tile ───────────────────────────────────────────────────────────── */

export type TileAssignee =
  | { kind: "named"; text: string }
  /** Tied to a person whose name is not known. Still ASSIGNED. */
  | { kind: "unnamed"; text: string }
  | { kind: "none"; text: string }
  /** Out-of-service rooms do not carry an assignment line unless someone is tied to them. */
  | { kind: "hidden"; text: null };

export type TileIcon =
  | "alert-circle-outline"
  | "refresh-outline"
  | "time-outline"
  | "eye-outline"
  | "checkmark-circle"
  | "ban-outline"
  | "help-circle-outline";

export interface RoomTileModel {
  roomId: string;
  roomNumber: string;
  /** The status as the backend sent it — drives the protected status colours. */
  rawStatus: string;
  stage: RoomStage;
  statusLabel: string;
  icon: TileIcon;
  assignee: TileAssignee;
  /** At most two, most important first. Never a guest name. */
  details: string[];
  flags: { vip: boolean; dnd: boolean; workOrder: boolean; note: boolean };
  accessibilityLabel: string;
  /** Everything the tile displays, so a memoised tile re-renders only when something visible changed. */
  signature: string;
}

const STAGE_ICON: Record<RoomStage, TileIcon> = {
  to_clean: "alert-circle-outline",
  in_progress: "time-outline",
  awaiting_inspection: "eye-outline",
  guest_ready: "checkmark-circle",
  unavailable: "ban-outline",
  unknown: "help-circle-outline",
};

function iconFor(room: BoardRoom): TileIcon {
  return room.statusInfo.code === "PICKUP" ? "refresh-outline" : STAGE_ICON[room.statusInfo.stage];
}

/** A recorded arrival on the hotel's current date for a room still being prepared; otherwise null. */
function arrivalToday(room: BoardRoom, now: number, timeZone: string | null | undefined, language: string): string | null {
  if (room.statusInfo.stage === "unavailable" || room.statusInfo.stage === "guest_ready") return null;
  if (!room.checkinTime) return null;
  const arrival = Date.parse(room.checkinTime);
  if (Number.isNaN(arrival) || hotelDateKey(new Date(arrival), timeZone) !== hotelDateKey(new Date(now), timeZone)) return null;
  return formatHotelTime(new Date(arrival), timeZone, language);
}

function assigneeOf(view: BoardRoomView, t: Translate): TileAssignee {
  const { room, assignee } = view;
  if (assignee) {
    return assignee.name
      ? { kind: "named", text: assignee.name }
      : { kind: "unnamed", text: t("roomBoard.assigneeUnknown") };
  }
  return room.statusInfo.stage === "unavailable" ? { kind: "hidden", text: null } : { kind: "none", text: t("roomBoard.unassigned") };
}

export interface TileContext {
  now: number;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
}

export function buildTileModel(view: BoardRoomView, ctx: TileContext): RoomTileModel {
  const { room } = view;
  const { t } = ctx;
  const info = room.statusInfo;
  const indicators = roomIndicators(room);
  const arrival = arrivalToday(room, ctx.now, ctx.timeZone, ctx.language);

  // Exceptions first, in a fixed order; each one is a recorded fact.
  const exceptions: string[] = [];
  if (indicators.recleanRequested && info.stage !== "unavailable") exceptions.push(t("roomBoard.card.detail.reclean"));
  if (indicators.vip) exceptions.push(t("roomBoard.card.detail.vip"));
  if (arrival) exceptions.push(t("roomBoard.card.detail.arrival", { time: arrival }));
  if (indicators.dnd) exceptions.push(t("roomBoard.card.detail.dnd"));
  if (indicators.serviceDeclined) exceptions.push(t("roomBoard.card.detail.declined"));
  if (indicators.lateCheckout) exceptions.push(t("roomBoard.card.detail.lateCheckout"));
  if (indicators.openWorkOrder && info.stage !== "unavailable") exceptions.push(t("roomBoard.card.detail.workOrder"));

  let details: string[];
  if (info.stage === "unavailable") {
    const reason = room.workOrder?.title ?? null;
    details = [reason ?? t("roomBoard.card.detail.unavailable"), ...exceptions].slice(0, 2);
  } else {
    details = exceptions.slice(0, 2);
    if (details.length === 0) details = [t(`roomBoard.card.base.${info.code ?? "UNKNOWN"}`)];
  }

  const statusLabel = t(`roomBoard.card.status.${info.code ?? "UNKNOWN"}`);
  const assignee = assigneeOf(view, t);
  const accessibilityLabel = [
    t("roomBoard.card.roomLabel", { room: room.roomNumber }),
    statusLabel,
    assignee.text,
    ...details,
  ]
    .filter(Boolean)
    .join(", ");
  const flags = { vip: indicators.vip, dnd: indicators.dnd, workOrder: indicators.openWorkOrder, note: indicators.hasNote };

  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    rawStatus: info.raw,
    stage: info.stage,
    statusLabel,
    icon: iconFor(room),
    assignee,
    details,
    flags,
    accessibilityLabel,
    signature: [
      room.roomId,
      room.roomNumber,
      info.raw,
      statusLabel,
      assignee.kind,
      assignee.text ?? "",
      details.join("|"),
      isUnassignedWork(room) ? 1 : 0,
      flags.vip ? 1 : 0,
      flags.dnd ? 1 : 0,
      flags.workOrder ? 1 : 0,
      flags.note ? 1 : 0,
    ].join("\u0001"),
  };
}

/** The one place the board's headline numbers come from (also used by the segment counts). */
export function buildBoardSummary(views: readonly BoardRoomView[]): BoardMetrics {
  return buildBoardMetrics(views.map((view) => view.room));
}

/* ─── Result rows (search / filtered / flat-sorted lists) ─────────────────── */

export interface ResultRowModel extends RoomTileModel {
  /** "Building A · Floor 2" — only the parts the backend actually sent. */
  location: string;
}

/** The compact list row: the tile's facts plus where the room is, since a list is not grouped under a floor heading. */
export function buildResultRowModel(view: BoardRoomView, ctx: TileContext): ResultRowModel {
  const tile = buildTileModel(view, ctx);
  const { room } = view;
  const parts: string[] = [];
  if (room.building) parts.push(ctx.t("roomBoard.building", { building: room.building }));
  parts.push(room.floorKnown ? ctx.t("roomBoard.floor", { floor: room.floor }) : ctx.t("roomBoard.floorUnknown"));
  const location = parts.join(" · ");
  return {
    ...tile,
    location,
    accessibilityLabel: `${tile.accessibilityLabel}, ${location}`,
    signature: `${tile.signature}\u0001${location}`,
  };
}
