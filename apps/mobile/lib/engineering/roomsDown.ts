import type { ActiveRoomPeriod } from "@/lib/api/engineeringRooms";

/* ─── Rooms down ───────────────────────────────────────────────────────────
   Which rooms are down right now and what is holding each one, for the Chief Engineer Home drawer. Pure: the server's
   ACTIVE out-of-order / out-of-service periods in, ordered display rows out. Only a confirmed period makes a room down;
   an open repair on its own does not. A finished repair does not release a room either, so that case is called out rather
   than hidden: somebody still has to release it. */

export interface ImpactRepair {
  id: string;
  /** "WO-1045" or null. */
  code: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  assignedTo: string | null;
}

export interface ImpactRow {
  periodId: string;
  roomId: string | null;
  roomNumber: string;
  floor: number | null;
  type: "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  reason: string | null;
  startedAt: string | null;
  expectedReturnAt: string | null;
  pastEta: boolean;
  repair: ImpactRepair | null;
  /** The linked repair is finished (or cancelled) but the room has not been released. */
  repairClosed: boolean;
}

const CLOSED = new Set(["completed", "cancelled"]);

function code(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  return `WO-${String(value).replace(/^WO-/i, "")}`;
}

function time(value: string | null): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** A period the server sent without a usable id or room number is dropped from the list but counted by the caller. */
export function toImpactRow(period: ActiveRoomPeriod): ImpactRow | null {
  const roomNumber = period.rooms?.room_number;
  if (!period.id || !roomNumber) return null;
  const wo = period.work_orders;
  const repair: ImpactRepair | null =
    wo && wo.id
      ? { id: wo.id, code: code(wo.work_order_number), title: wo.title ?? null, status: wo.status ?? null, priority: wo.priority ?? null, assignedTo: wo.assigned_to ?? null }
      : null;
  return {
    periodId: period.id,
    roomId: period.room_id ?? null,
    roomNumber: String(roomNumber),
    floor: period.rooms?.floor ?? null,
    type: period.type,
    reason: period.reason_label ?? null,
    startedAt: period.started_at ?? null,
    expectedReturnAt: period.expected_return_at ?? null,
    pastEta: period.is_past_eta === true,
    repair,
    repairClosed: repair?.status != null && CLOSED.has(repair.status),
  };
}

/** Past expected return first, then the soonest expected return (none last), then room number as a number-aware text sort. */
export function compareImpact(a: ImpactRow, b: ImpactRow): number {
  if (a.pastEta !== b.pastEta) return a.pastEta ? -1 : 1;
  const eta = time(a.expectedReturnAt) - time(b.expectedReturnAt);
  if (eta !== 0 && !Number.isNaN(eta)) return eta < 0 ? -1 : 1;
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) || a.periodId.localeCompare(b.periodId);
}

export interface RoomsDown {
  rows: ImpactRow[];
  /** Periods the server sent that could not be shown (no id or room number). Never silently dropped. */
  unreadable: number;
  /** Rooms with no repair linked at all, or whose repair is finished: the ones that need a decision. */
  needsDecision: number;
}

export function buildRoomsDown(periods: readonly ActiveRoomPeriod[]): RoomsDown {
  const rows: ImpactRow[] = [];
  let unreadable = 0;
  for (const period of periods) {
    const row = toImpactRow(period);
    if (row) rows.push(row);
    else unreadable += 1;
  }
  rows.sort(compareImpact);
  return { rows, unreadable, needsDecision: rows.filter((r) => r.repair == null || r.repairClosed).length };
}
