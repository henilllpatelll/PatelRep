/* ─── Room readiness from the housekeeping board ──────────────────────────────
   One board row per room (`GET /housekeeping/board`, not paginated). Housekeeping condition, occupancy and
   availability are three different questions, so they are counted separately and never added together: an occupied
   room is not "dirty", and an out-of-order room is not "occupied". The occupancy and out-of-order rules are the
   ones the Room Status screen already uses (it imports them from here). */

export type BoardStatusRow = {
  room_id?: string;
  status?: string | null;
  fo_status?: "OCC" | "VAC" | string | null;
};

/** Occupied by any signal: Opera front-office status, or a stay-driven room status. */
export function isOccupiedBoardRow(row: { status?: string | null; fo_status?: string | null }): boolean {
  return row.fo_status === "OCC" || row.status === "OCCUPIED" || row.status === "PICKUP";
}

export function isOutOfOrderBoardRow(row: { status?: string | null }): boolean {
  return row.status === "OOO" || row.status === "OUT_OF_ORDER" || row.status === "OUT_OF_SERVICE";
}

export interface RoomReadiness {
  total: number;
  /** Housekeeping condition (rooms that are not out of order). */
  inspected: number;
  clean: number;
  dirty: number;
  inProgress: number;
  /** Stayover / pickup service owed. */
  pickup: number;
  /** Occupancy, independent of condition. */
  occupied: number;
  vacant: number;
  /** Availability: maintenance has the room. */
  outOfOrder: number;
  /** Rows whose status the app does not recognise are counted here instead of being folded into another bucket. */
  other: number;
}

export function summarizeRoomReadiness(rows: readonly BoardStatusRow[]): RoomReadiness {
  const out: RoomReadiness = { total: rows.length, inspected: 0, clean: 0, dirty: 0, inProgress: 0, pickup: 0, occupied: 0, vacant: 0, outOfOrder: 0, other: 0 };
  for (const row of rows) {
    if (isOccupiedBoardRow(row)) out.occupied += 1;
    else out.vacant += 1;
    if (isOutOfOrderBoardRow(row)) {
      out.outOfOrder += 1;
      continue;
    }
    switch (row.status) {
      case "INSPECTED":
        out.inspected += 1;
        break;
      case "CLEAN":
        out.clean += 1;
        break;
      case "DIRTY":
        out.dirty += 1;
        break;
      case "IN_PROGRESS":
        out.inProgress += 1;
        break;
      case "PICKUP":
        out.pickup += 1;
        break;
      case "OCCUPIED":
        break;
      default:
        out.other += 1;
    }
  }
  return out;
}

/** Rooms that are guest-ready: inspected, not merely cleaned. Share of the whole property, 0 to 100, or null for an empty board. */
export function readyPercent(r: RoomReadiness): number | null {
  if (r.total === 0) return null;
  return Math.round((r.inspected / r.total) * 100);
}
