import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { DEFAULT_ROOM_PRIORITY, type BoardRoom, type RoomStage } from "@/lib/housekeeping/roomBoardModel";
import { compareRoomNumbers, isUnassignedWork, urgentReasons } from "@/lib/housekeeping/roomBoardSelectors";

/* ─── Room Board — sorting ──────────────────────────────────────────────────
   Six deterministic sort modes over verified rooms. Every mode ends in the same location tie-break
   (building → floor → natural room number → room id), so two renders of the same data are never ordered
   differently. Nothing here invents a deadline or trusts a forecast: a missing or out-of-date timestamp
   sorts last, it is never read as "immediately".

   PRIORITY FIRST (the default) — each rule only breaks ties left by the one above:
     1. work still to do (unrecognised statuses first, so they get looked at) → guest-ready → out of service
     2. more RECORDED urgent reasons first (reclean request, arrival time passed today, VIP not ready,
        elevated stored priority, stored HIGH risk — see `urgentReasons`)
     3. the stronger explicit priority first (a stored priority below the schema default of 5; 1 is highest)
     4. unassigned actionable rooms before assigned ones
     5. a recorded arrival today before an unknown one, earlier first (an arrival is NOT a cleaning deadline;
        it only orders rooms that are otherwise equal)
     6. awaiting inspection → to clean → in progress (the supervisor's own queue first)
   Room number, departure, arrival and floor modes are what they say; cleaning status follows the day's flow. */

export type BoardSortKey = "priority" | "roomNumber" | "departure" | "arrival" | "status" | "floor";

export const BOARD_SORTS: readonly BoardSortKey[] = ["priority", "roomNumber", "departure", "arrival", "status", "floor"];
export const DEFAULT_SORT: BoardSortKey = "priority";

/** Modes whose order only makes sense across the whole hotel; the board shows them as one flat list. */
export function isFlatSort(sort: BoardSortKey): boolean {
  return sort === "departure" || sort === "arrival" || sort === "status";
}

export interface SortContext {
  now: number;
  timeZone: string | null | undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Building (none last) → floor (unknown last) → natural room number → room id. */
export function compareLocation(a: BoardRoom, b: BoardRoom): number {
  if (a.building !== b.building) {
    if (a.building === null) return 1;
    if (b.building === null) return -1;
    const building = collator.compare(a.building, b.building);
    if (building !== 0) return building;
  }
  const floorA = a.floorKnown ? a.floor : null;
  const floorB = b.floorKnown ? b.floor : null;
  if (floorA !== floorB) {
    if (floorA === null) return 1;
    if (floorB === null) return -1;
    return floorA - floorB;
  }
  return compareRoomNumbers(a, b);
}

const WORK_RANK: Record<RoomStage, number> = {
  unknown: 0,
  to_clean: 1,
  in_progress: 1,
  awaiting_inspection: 1,
  guest_ready: 2,
  unavailable: 3,
};

const QUEUE_RANK: Record<RoomStage, number> = {
  awaiting_inspection: 0,
  to_clean: 1,
  in_progress: 2,
  unknown: 3,
  guest_ready: 4,
  unavailable: 5,
};

const FLOW_RANK: Record<RoomStage, number> = {
  unknown: 0,
  to_clean: 1,
  in_progress: 2,
  awaiting_inspection: 3,
  guest_ready: 4,
  unavailable: 5,
};

/**
 * A timestamp the board may order by: parseable and on the hotel's current date or later. A time left over
 * from an earlier day is stale, so it is treated like a missing one (sorts last) rather than first.
 */
export function usableTime(value: string | null, ctx: SortContext): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const day = hotelDateKey(new Date(at), ctx.timeZone);
  const today = hotelDateKey(new Date(ctx.now), ctx.timeZone);
  return day !== null && today !== null && day >= today ? at : null;
}

function arrivalToday(room: BoardRoom, ctx: SortContext): number | null {
  const at = usableTime(room.checkinTime, ctx);
  if (at === null) return null;
  const day = hotelDateKey(new Date(at), ctx.timeZone);
  return day !== null && day === hotelDateKey(new Date(ctx.now), ctx.timeZone) ? at : null;
}

/** Ascending with unknown (null) last. */
function compareNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

interface PriorityKey {
  work: number;
  urgent: number;
  elevated: number | null;
  unassigned: number;
  arrival: number | null;
  queue: number;
}

function priorityKey(room: BoardRoom, ctx: SortContext): PriorityKey {
  return {
    work: WORK_RANK[room.statusInfo.stage],
    urgent: urgentReasons(room, ctx.now, ctx.timeZone).length,
    elevated: room.priority !== null && room.priority < DEFAULT_ROOM_PRIORITY ? room.priority : null,
    unassigned: isUnassignedWork(room) ? 0 : 1,
    arrival: arrivalToday(room, ctx),
    queue: QUEUE_RANK[room.statusInfo.stage],
  };
}

function comparePriorityKeys(a: PriorityKey, b: PriorityKey): number {
  return (
    a.work - b.work ||
    b.urgent - a.urgent ||
    compareNullsLast(a.elevated, b.elevated) ||
    a.unassigned - b.unassigned ||
    compareNullsLast(a.arrival, b.arrival) ||
    a.queue - b.queue
  );
}

/**
 * Sorts a copy of `views`. Sort keys are computed once per room, not once per comparison, so ordering a
 * several-hundred-room hotel stays cheap on every realtime update.
 */
export function sortViews<T extends { room: BoardRoom }>(views: readonly T[], sort: BoardSortKey, ctx: SortContext): T[] {
  const keyed = views.map((view) => {
    const room = view.room;
    switch (sort) {
      case "priority":
        return { view, primary: priorityKey(room, ctx) as PriorityKey | number | null };
      case "departure":
        return { view, primary: usableTime(room.checkoutTime, ctx) as PriorityKey | number | null };
      case "arrival":
        return { view, primary: usableTime(room.checkinTime, ctx) as PriorityKey | number | null };
      case "status":
        return { view, primary: FLOW_RANK[room.statusInfo.stage] as PriorityKey | number | null };
      default:
        return { view, primary: 0 as PriorityKey | number | null };
    }
  });
  keyed.sort((a, b) => {
    let first = 0;
    if (sort === "priority") first = comparePriorityKeys(a.primary as PriorityKey, b.primary as PriorityKey);
    else if (sort === "departure" || sort === "arrival") first = compareNullsLast(a.primary as number | null, b.primary as number | null);
    else if (sort === "status") first = (a.primary as number) - (b.primary as number);
    if (first !== 0) return first;
    // Room number sorts purely by natural number; every other mode falls back to the full location order.
    return sort === "roomNumber" ? compareRoomNumbers(a.view.room, b.view.room) : compareLocation(a.view.room, b.view.room);
  });
  return keyed.map((entry) => entry.view);
}
