import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import {
  DEFAULT_ROOM_PRIORITY,
  type BoardRoom,
  type RoomStage,
} from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView, BoardStaffMember, RosterTrust } from "@/lib/housekeeping/roomBoardState";
import { isActionable } from "@/lib/housekeeping/supervisor";

/* ─── Room Board — selectors ────────────────────────────────────────────────
   Pure, deterministic derivations over verified `BoardRoom`s. Every screen of the redesigned board
   (list, filters, drawers, pickers) reads through these so the answers cannot drift apart.

   Nothing here invents a deadline or trusts a forecast: an urgent room is urgent because of a RECORDED
   fact (a reclean request, a VIP not yet ready, a priority set below the default, a stored HIGH risk, a
   guest arrival time that has already passed), and an unknown value never ranks above a known one. */

type RoomLike = Pick<BoardRoom, "roomId" | "roomNumber">;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareRoomNumbers(a: RoomLike, b: RoomLike): number {
  return collator.compare(a.roomNumber, b.roomNumber) || a.roomId.localeCompare(b.roomId);
}

export function sortByRoomNumber<T extends RoomLike>(rooms: readonly T[]): T[] {
  return [...rooms].sort(compareRoomNumbers);
}

/* ─── Grouping ────────────────────────────────────────────────────────────── */

export interface FloorGroupOf<T> {
  /** null = the backend sent no floor for these rooms. */
  floor: number | null;
  rooms: T[];
}

export interface BuildingGroupOf<T> {
  /** null = the backend sent no building for these rooms. */
  building: string | null;
  floors: FloorGroupOf<T>[];
}

/**
 * Building → floor → rooms. Buildings sort by name with "no building" last; floors ascend with "no floor"
 * last; rooms sort by number. A room with no floor is NOT placed on floor 0.
 */
export function groupByBuildingAndFloor<T extends { room: BoardRoom } | BoardRoom>(rooms: readonly T[]): BuildingGroupOf<T>[] {
  const roomOf = (item: T): BoardRoom => ("room" in item ? item.room : item);
  const byBuilding = new Map<string | null, Map<number | null, T[]>>();
  for (const item of rooms) {
    const room = roomOf(item);
    const building = room.building;
    const floor = room.floorKnown ? room.floor : null;
    let floors = byBuilding.get(building);
    if (!floors) byBuilding.set(building, (floors = new Map()));
    const list = floors.get(floor);
    if (list) list.push(item);
    else floors.set(floor, [item]);
  }
  const nullsLast = <K extends string | number>(a: K | null, b: K | null): number => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  };
  return [...byBuilding.entries()]
    .sort(([a], [b]) => nullsLast(a, b))
    .map(([building, floors]) => ({
      building,
      floors: [...floors.entries()]
        .sort(([a], [b]) => nullsLast(a, b))
        .map(([floor, list]) => ({ floor, rooms: [...list].sort((a, b) => compareRoomNumbers(roomOf(a), roomOf(b))) })),
    }));
}

/* ─── Filters ─────────────────────────────────────────────────────────────── */

export function filterByStage<T extends { room: BoardRoom }>(views: readonly T[], stages: readonly RoomStage[]): T[] {
  const wanted = new Set(stages);
  return views.filter((view) => wanted.has(view.room.statusInfo.stage));
}

/** Exact backend status codes (DIRTY, OCCUPIED, PICKUP, …). Unrecognised statuses match by their raw text. */
export function filterByStatus<T extends { room: BoardRoom }>(views: readonly T[], statuses: readonly string[]): T[] {
  const wanted = new Set(statuses);
  return views.filter((view) => wanted.has(view.room.statusInfo.raw));
}

/** In-service rooms still needing housekeeping that no one is tied to. Not "no display name". */
export function isUnassignedWork(room: BoardRoom): boolean {
  return isActionable(room.status) && room.assignment.userId === null;
}

export function filterUnassigned<T extends { room: BoardRoom }>(views: readonly T[]): T[] {
  return views.filter((view) => isUnassignedWork(view.room));
}

/** Rooms housekeeping has submitted that still need an inspector. CLEAN is never treated as ready. */
export function findAwaitingInspection<T extends { room: BoardRoom }>(views: readonly T[]): T[] {
  return views.filter((view) => view.room.statusInfo.stage === "awaiting_inspection");
}

/* ─── Search ──────────────────────────────────────────────────────────────── */

/**
 * Room-number search: case-insensitive, whitespace-trimmed. An exact match comes first, then rooms whose
 * number starts with the query, then rooms that contain it. An empty query returns everything, unchanged.
 */
export function searchByRoomNumber<T extends { room: BoardRoom }>(views: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...views];
  const rank = (view: T): number => {
    const number = view.room.roomNumber.trim().toLowerCase();
    if (number === needle) return 0;
    if (number.startsWith(needle)) return 1;
    return number.includes(needle) ? 2 : 3;
  };
  return views
    .map((view) => ({ view, rank: rank(view) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || compareRoomNumbers(a.view.room, b.view.room))
    .map((entry) => entry.view);
}

/* ─── Urgency ─────────────────────────────────────────────────────────────── */

/** Every reason is a recorded fact; there is no inferred deadline. */
export type UrgentReason = "reclean_requested" | "arrival_passed" | "vip_not_ready" | "priority_elevated" | "high_risk";

const REASON_ORDER: readonly UrgentReason[] = ["reclean_requested", "arrival_passed", "vip_not_ready", "priority_elevated", "high_risk"];

/** A room that is out of service, or already guest-ready, cannot be urgent. */
function canBeUrgent(room: BoardRoom): boolean {
  return room.statusInfo.stage !== "unavailable" && room.statusInfo.stage !== "guest_ready";
}

/**
 * `arrival_passed`: the room's recorded guest arrival is on the hotel's current date and has already
 * passed while the room is not guest-ready. A check-in time left over from another day is ignored.
 */
export function urgentReasons(room: BoardRoom, now: number, timeZone: string | null | undefined): UrgentReason[] {
  if (!canBeUrgent(room)) return [];
  const reasons: UrgentReason[] = [];
  if (room.recleanRequestedAt) reasons.push("reclean_requested");
  if (room.checkinTime) {
    const arrival = Date.parse(room.checkinTime);
    const today = hotelDateKey(new Date(now), timeZone);
    if (!Number.isNaN(arrival) && arrival <= now && hotelDateKey(new Date(arrival), timeZone) === today) reasons.push("arrival_passed");
  }
  if (room.vip) reasons.push("vip_not_ready");
  if (room.priority !== null && room.priority < DEFAULT_ROOM_PRIORITY) reasons.push("priority_elevated");
  if (room.prediction?.riskLevel === "HIGH") reasons.push("high_risk");
  return REASON_ORDER.filter((reason) => reasons.includes(reason));
}

export function findUrgentRooms<T extends { room: BoardRoom }>(
  views: readonly T[],
  now: number,
  timeZone: string | null | undefined,
): T[] {
  return views.filter((view) => urgentReasons(view.room, now, timeZone).length > 0);
}

/* ─── Sorting ─────────────────────────────────────────────────────────────── */

export type BoardSortMode = "roomNumber" | "priority";

const STAGE_RANK: Record<RoomStage, number> = {
  // Work that still needs a person comes first; an unrecognised status needs a look, so it is not buried.
  unknown: 0,
  to_clean: 1,
  in_progress: 1,
  awaiting_inspection: 1,
  guest_ready: 2,
  unavailable: 3,
};

/**
 * Deterministic operational order (ties always fall through to the next rule, ending at room number):
 *  1. work still to do → guest-ready → unavailable
 *  2. more recorded urgent reasons first
 *  3. a known arrival today before an unknown one, earlier first
 *  4. awaiting inspection before to-clean before in-progress (the supervisor's own queue first)
 *  5. room number (natural order), then room id
 */
export function compareByOperationalPriority(
  a: BoardRoom,
  b: BoardRoom,
  now: number,
  timeZone: string | null | undefined,
): number {
  const stage = STAGE_RANK[a.statusInfo.stage] - STAGE_RANK[b.statusInfo.stage];
  if (stage !== 0) return stage;
  const urgency = urgentReasons(b, now, timeZone).length - urgentReasons(a, now, timeZone).length;
  if (urgency !== 0) return urgency;
  const arrivalA = knownArrivalToday(a, now, timeZone);
  const arrivalB = knownArrivalToday(b, now, timeZone);
  if (arrivalA !== arrivalB) {
    if (arrivalA === null) return 1;
    if (arrivalB === null) return -1;
    return arrivalA - arrivalB;
  }
  const own = OWN_QUEUE_RANK[a.statusInfo.stage] - OWN_QUEUE_RANK[b.statusInfo.stage];
  if (own !== 0) return own;
  return compareRoomNumbers(a, b);
}

const OWN_QUEUE_RANK: Record<RoomStage, number> = {
  awaiting_inspection: 0,
  to_clean: 1,
  in_progress: 2,
  unknown: 3,
  guest_ready: 4,
  unavailable: 5,
};

function knownArrivalToday(room: BoardRoom, now: number, timeZone: string | null | undefined): number | null {
  if (!room.checkinTime) return null;
  const arrival = Date.parse(room.checkinTime);
  if (Number.isNaN(arrival)) return null;
  return hotelDateKey(new Date(arrival), timeZone) === hotelDateKey(new Date(now), timeZone) ? arrival : null;
}

export function sortRooms<T extends { room: BoardRoom }>(
  views: readonly T[],
  mode: BoardSortMode,
  now: number,
  timeZone: string | null | undefined,
): T[] {
  const list = [...views];
  return mode === "roomNumber"
    ? list.sort((a, b) => compareRoomNumbers(a.room, b.room))
    : list.sort((a, b) => compareByOperationalPriority(a.room, b.room, now, timeZone));
}

/* ─── Metrics ─────────────────────────────────────────────────────────────── */

export interface BoardMetrics {
  /** Every room on the board, out-of-service included. */
  inventory: number;
  /** Rooms that can be sold: inventory minus unavailable. The readiness denominator. */
  inService: number;
  unavailable: number;
  guestReady: number;
  awaitingInspection: number;
  inProgress: number;
  toClean: number;
  unknown: number;
  unassigned: number;
  vip: number;
  dnd: number;
  serviceDeclined: number;
  /** guestReady ÷ inService in [0, 1]; null when nothing is in service (no progress to claim). */
  readiness: number | null;
}

export function buildBoardMetrics(rooms: readonly BoardRoom[]): BoardMetrics {
  const metrics: BoardMetrics = {
    inventory: rooms.length,
    inService: 0,
    unavailable: 0,
    guestReady: 0,
    awaitingInspection: 0,
    inProgress: 0,
    toClean: 0,
    unknown: 0,
    unassigned: 0,
    vip: 0,
    dnd: 0,
    serviceDeclined: 0,
    readiness: null,
  };
  for (const room of rooms) {
    switch (room.statusInfo.stage) {
      case "unavailable":
        metrics.unavailable += 1;
        continue;
      case "guest_ready":
        metrics.guestReady += 1;
        break;
      case "awaiting_inspection":
        metrics.awaitingInspection += 1;
        break;
      case "in_progress":
        metrics.inProgress += 1;
        break;
      case "to_clean":
        metrics.toClean += 1;
        break;
      case "unknown":
        metrics.unknown += 1;
        break;
    }
    metrics.inService += 1;
    if (isUnassignedWork(room)) metrics.unassigned += 1;
    if (room.vip) metrics.vip += 1;
    if (room.dnd) metrics.dnd += 1;
    if (room.serviceDeclined.declined) metrics.serviceDeclined += 1;
  }
  metrics.readiness = metrics.inService > 0 ? Math.min(1, metrics.guestReady / metrics.inService) : null;
  return metrics;
}

/* ─── Indicators & assignment ─────────────────────────────────────────────── */

export interface RoomIndicators {
  vip: boolean;
  dnd: boolean;
  serviceDeclined: boolean;
  /** An inspection is wanted: the room awaits one AND the backend flagged it (null flag → not claimed). */
  inspectionRequired: boolean;
  /** Housekeeping submitted; any inspector may pass it. */
  awaitingInspection: boolean;
  recleanRequested: boolean;
  openWorkOrder: boolean;
  hasNote: boolean;
  lateCheckout: boolean;
  highRisk: boolean;
}

export function roomIndicators(room: BoardRoom): RoomIndicators {
  const awaiting = room.statusInfo.stage === "awaiting_inspection";
  return {
    vip: room.vip,
    dnd: room.dnd,
    serviceDeclined: room.serviceDeclined.declined,
    inspectionRequired: awaiting && room.inspectionRequired === true,
    awaitingInspection: awaiting,
    recleanRequested: room.recleanRequestedAt !== null,
    openWorkOrder: room.workOrder !== null,
    hasNote: Boolean(room.latestNote),
    lateCheckout: room.lateCheckout !== null,
    highRisk: room.prediction?.riskLevel === "HIGH",
  };
}

/** The room's current assignment, or null. */
export function currentAssignment(view: BoardRoomView): BoardRoomView["assignee"] {
  return view.assignee;
}

/**
 * Staff who can take work, with attendance stated honestly. With a verified roster only people it shows
 * `on_shift` are offered (`restrictedToShift: true`); otherwise EVERYONE is offered with attendance
 * `unknown` and `restrictedToShift: false` — the picker must say so rather than imply they are working.
 * Least-loaded first, then name.
 */
export function selectAvailableStaff(
  staff: readonly BoardStaffMember[],
  rosterTrust: RosterTrust,
): { members: BoardStaffMember[]; restrictedToShift: boolean } {
  const verified = rosterTrust === "verified";
  const pool = verified ? staff.filter((member) => member.availability === "on_shift") : [...staff];
  const members = pool.sort(
    (a, b) => a.openRooms - b.openRooms || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.userId.localeCompare(b.userId),
  );
  return { members, restrictedToShift: verified };
}
