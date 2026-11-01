/* ─── Engineering Rooms model ───────────────────────────────────────────────
   Pure types and rules for the rooms board and Room Detail. The API
   (GET /rooms/engineering-board) is the authority: filters, search, sort and
   paging all run on the server over the whole hotel. Guest occupancy,
   housekeeping status, the out-of-order / out-of-service period and active
   repairs are four separate facts and are kept separate here. Nothing in this
   file ever derives "available for sale". */

import type { WorkOrderPriority, WorkOrderStatus } from "@/lib/engineering/workOrders";

export type RoomOccupancy = "occupied" | "vacant" | "unknown";
/** `unrecorded_down`: the room status says down but PatelRep holds no out-of-order record for it. */
export type RoomAvailability = "out_of_order" | "out_of_service" | "unrecorded_down";

export interface RoomUnavailability {
  id: string;
  type: "OUT_OF_ORDER" | "OUT_OF_SERVICE";
  reason_code?: string | null;
  reason_label?: string | null;
  started_at?: string | null;
  expected_return_at?: string | null;
  primary_work_order_id?: string | null;
  source?: string | null;
  is_past_eta?: boolean;
}

export interface RoomTopRepair {
  id: string;
  work_order_number?: string | null;
  title?: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assigned_to?: string | null;
}

export interface RoomBoardRow {
  id: string;
  room_number: string;
  floor: number | null;
  building: string | null;
  room_type: { name?: string | null; code?: string | null } | null;
  occupancy: RoomOccupancy;
  housekeeping_status: string | null;
  availability: RoomAvailability | null;
  unavailability: RoomUnavailability | null;
  active_repair_count: number;
  /** Repairs held by colleagues that a line engineer cannot open; shown as a count only. */
  others_active_count: number;
  top_priority: WorkOrderPriority | null;
  top_repair: RoomTopRepair | null;
  last_activity_at: string | null;
  status_updated_at: string | null;
}

export interface RoomBoardCounts {
  total: number;
  active_repairs: number;
  unavailable: number;
  occupied: number;
}

export interface RoomBoardPage {
  rows: RoomBoardRow[];
  total: number;
  hasMore: boolean;
  counts: RoomBoardCounts | null;
  floors: number[];
  buildings: string[];
}

export const ROOM_MAINTENANCE_FILTERS = ["active", "none", "unavailable", "ooo", "oos"] as const;
export type RoomMaintenanceFilter = (typeof ROOM_MAINTENANCE_FILTERS)[number];
export const ROOM_OCCUPANCY_FILTERS = ["occupied", "vacant", "unknown"] as const;
export const ROOM_PRIORITY_FILTERS: readonly WorkOrderPriority[] = ["emergency", "urgent", "normal", "low"];
export const ROOM_SORTS = ["room", "floor", "urgency", "updated"] as const;
export type RoomSort = (typeof ROOM_SORTS)[number];

export interface RoomFilters {
  maintenance: RoomMaintenanceFilter | null;
  occupancy: RoomOccupancy | null;
  floor: number | null;
  building: string | null;
  priority: WorkOrderPriority | null;
  sort: RoomSort;
}

export const EMPTY_ROOM_FILTERS: RoomFilters = {
  maintenance: null,
  occupancy: null,
  floor: null,
  building: null,
  priority: null,
  sort: "room",
};

/** The four quick chips. Each is a shortcut onto the same fields the sheet edits, so the two can never disagree. */
export const ROOM_QUICK_FILTERS = ["all", "active", "unavailable", "occupied"] as const;
export type RoomQuickFilter = (typeof ROOM_QUICK_FILTERS)[number];

export function quickFilterOf(filters: RoomFilters): RoomQuickFilter | null {
  const { maintenance, occupancy, floor, building, priority } = filters;
  if (floor != null || building || priority) return null;
  if (!maintenance && !occupancy) return "all";
  if (maintenance === "active" && !occupancy) return "active";
  if (maintenance === "unavailable" && !occupancy) return "unavailable";
  if (occupancy === "occupied" && !maintenance) return "occupied";
  return null;
}

export function applyQuickFilter(filters: RoomFilters, quick: RoomQuickFilter): RoomFilters {
  const cleared = { ...filters, maintenance: null, occupancy: null } satisfies RoomFilters;
  if (quick === "active") return { ...cleared, maintenance: "active" };
  if (quick === "unavailable") return { ...cleared, maintenance: "unavailable" };
  if (quick === "occupied") return { ...cleared, occupancy: "occupied" };
  return cleared;
}

/** How many sheet filters are on (sort is not a filter). Shown on the filter button. */
export function activeRoomFilterCount(filters: RoomFilters): number {
  return [filters.maintenance, filters.occupancy, filters.floor, filters.building, filters.priority].filter(
    (value) => value != null && value !== "",
  ).length;
}

export function hasAnyRoomFilter(filters: RoomFilters, query: string): boolean {
  return activeRoomFilterCount(filters) > 0 || query.trim().length > 0;
}

export type RoomBoardParams = Record<string, string | number | undefined>;

export function roomBoardParams(filters: RoomFilters, query: string): RoomBoardParams {
  return {
    q: query.trim() || undefined,
    maintenance: filters.maintenance ?? undefined,
    occupancy: filters.occupancy ?? undefined,
    floor: filters.floor ?? undefined,
    building: filters.building?.trim() || undefined,
    priority: filters.priority ?? undefined,
    sort_by: filters.sort === "room" ? undefined : filters.sort,
  };
}

/** Identity of one search + filter combination (the cache and stale-request key). */
export function roomBoardKey(filters: RoomFilters, query: string): string {
  return JSON.stringify(roomBoardParams(filters, query));
}

/** Append a page, keeping the first copy of any room that appears twice (a room can shift between pages). */
export function mergeRoomPages(existing: readonly RoomBoardRow[], next: readonly RoomBoardRow[]): RoomBoardRow[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...next.filter((row) => !seen.has(row.id))];
}

export interface FloorGroup {
  floor: number | null;
  rooms: RoomBoardRow[];
}

/** Group by floor in the order the rows arrived. A sort that is not by room/floor keeps one flat group. */
export function groupRoomsByFloor(rows: readonly RoomBoardRow[], sort: RoomSort): FloorGroup[] {
  if (sort === "urgency" || sort === "updated") return rows.length ? [{ floor: null, rooms: [...rows] }] : [];
  const groups: FloorGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.floor === row.floor) last.rooms.push(row);
    else groups.push({ floor: row.floor, rooms: [row] });
  }
  return groups;
}

/** OOO/OOS and the unrecorded case, as one small set the badge and the filters share. */
export function availabilityKind(row: Pick<RoomBoardRow, "availability">): RoomAvailability | null {
  return row.availability;
}

export function isRoomDown(row: Pick<RoomBoardRow, "availability">): boolean {
  return row.availability != null;
}

/** Roles whose availability writes the API accepts (`MANAGE_ROLES`). chief_engineer reads but cannot change a room. */
const AVAILABILITY_ROLES: readonly string[] = ["engineer", "gm", "housekeeping_supervisor"];

export function canManageAvailability(role: string | null | undefined): boolean {
  return role != null && AVAILABILITY_ROLES.includes(role);
}

/** The type a period is recorded as, for the dedicated endpoints. */
export function periodTypeOf(availability: RoomAvailability | "out_of_order" | "out_of_service"): "OUT_OF_ORDER" | "OUT_OF_SERVICE" {
  return availability === "out_of_service" ? "OUT_OF_SERVICE" : "OUT_OF_ORDER";
}

/** "Room 312 · Floor 3 · King" style context line; each part only when the server sent it. */
export function roomContextParts(row: Pick<RoomBoardRow, "floor" | "building" | "room_type">): { floor: number | null; building: string | null; type: string | null } {
  return { floor: row.floor, building: row.building?.trim() || null, type: row.room_type?.name?.trim() || null };
}
