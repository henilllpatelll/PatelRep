import {
  NONE_KEY,
  applySearch,
  floorKeyOf,
  isSearching,
} from "@/lib/housekeeping/roomBoardFilters";
import { compareRoomNumbers } from "@/lib/housekeeping/roomBoardSelectors";
import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import { comparePriority, type PriorityTier } from "@/lib/housekeeping/assignmentPriority";
import { isRemainingWork } from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — search, filter and sort ──────────────────────
   Pure. dataset → search → location/priority filters → (scope counts) → scope → sort.

   THE DATASET is the assignment QUEUE: in-service rooms still to clean or being cleaned
   (`queueOf`). Rooms already submitted, inspected or out of service are not assignment work and never
   appear here, whatever the filters say.

   Scope counts are taken AFTER search and the other filters but BEFORE the scope's own restriction, so the
   chips add up to what the filters leave and "All" is exactly that number. A filtered-out room is still on
   the board: deep links and detail sheets read the full dataset, never a query result. */

export type AssignmentScope = "all" | "unassigned" | "assigned" | "urgent" | "blocked";

export const ASSIGNMENT_SCOPES: readonly AssignmentScope[] = ["all", "unassigned", "assigned", "urgent", "blocked"];

export type AssignmentSortKey = "priority" | "roomNumber" | "location";

export interface AssignmentFilters {
  /** A building name, NONE_KEY for rooms with no building, or null for every building. */
  building: string | null;
  /** `floorKeyOf` keys. Empty = every floor of the selected building(s). */
  floors: string[];
  tiers: PriorityTier[];
}

export const EMPTY_ASSIGNMENT_FILTERS: AssignmentFilters = { building: null, floors: [], tiers: [] };

export function assignmentFilterCount(filters: AssignmentFilters): number {
  return (filters.building !== null ? 1 : 0) + filters.floors.length + filters.tiers.length;
}

/** The rooms the Rooms tab works with: remaining work, in the model's priority order. */
export function queueOf(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => isRemainingWork(entry.room));
}

function inScope(entry: AssignmentRoom, scope: AssignmentScope): boolean {
  switch (scope) {
    case "all":
      return true;
    case "unassigned":
      return entry.eligibility.needsAssignee;
    case "assigned":
      return entry.ownership.assigned;
    case "urgent":
      return entry.priority.tier !== "routine";
    case "blocked":
      return entry.eligibility.softBlocks.length > 0;
  }
}

function matchesFilters(entry: AssignmentRoom, filters: AssignmentFilters): boolean {
  const { room } = entry;
  if (filters.building !== null && (room.building ?? NONE_KEY) !== filters.building) return false;
  if (filters.floors.length > 0 && !filters.floors.includes(floorKeyOf(room))) return false;
  if (filters.tiers.length > 0 && !filters.tiers.includes(entry.priority.tier)) return false;
  return true;
}

function compareLocation(a: AssignmentRoom, b: AssignmentRoom): number {
  const nullsLast = (x: number | null, y: number | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y);
  if (a.room.building !== b.room.building) {
    if (a.room.building === null) return 1;
    if (b.room.building === null) return -1;
    return a.room.building.localeCompare(b.room.building, undefined, { numeric: true });
  }
  return nullsLast(a.room.floorKnown ? a.room.floor : null, b.room.floorKnown ? b.room.floor : null) || compareRoomNumbers(a.room, b.room);
}

export function sortAssignmentRooms(rooms: readonly AssignmentRoom[], key: AssignmentSortKey): AssignmentRoom[] {
  const list = [...rooms];
  switch (key) {
    case "priority":
      return list.sort(comparePriority);
    case "roomNumber":
      return list.sort((a, b) => compareRoomNumbers(a.room, b.room));
    case "location":
      return list.sort(compareLocation);
  }
}

export interface AssignmentQueryInput {
  /** Normally `queueOf(model.rooms)`. */
  rooms: readonly AssignmentRoom[];
  search: string;
  filters: AssignmentFilters;
  scope: AssignmentScope;
  sort: AssignmentSortKey;
}

export type AssignmentEmptyReason = "search" | "filters" | "scope" | null;

export interface AssignmentQueryResult {
  searching: boolean;
  filtering: boolean;
  /** Rooms in the dataset. */
  total: number;
  /** After search and filters, before the scope. */
  matched: AssignmentRoom[];
  counts: Record<AssignmentScope, number>;
  /** Scope applied and sorted: what the supervisor sees. A search keeps exact → prefix → contains first. */
  visible: AssignmentRoom[];
  emptyReason: AssignmentEmptyReason;
}

export function runAssignmentQuery(input: AssignmentQueryInput): AssignmentQueryResult {
  const { rooms, search, filters, scope, sort } = input;
  const searching = isSearching(search);
  const filtering = assignmentFilterCount(filters) > 0;
  const searched = applySearch(rooms, search);
  const matched = searched.filter((entry) => matchesFilters(entry, filters));
  const counts = Object.fromEntries(ASSIGNMENT_SCOPES.map((key) => [key, matched.filter((entry) => inScope(entry, key)).length])) as Record<AssignmentScope, number>;
  const scoped = matched.filter((entry) => inScope(entry, scope));
  // A search result keeps its rank bands (exact, prefix, contains); the sort applies within each band.
  const visible = searching ? sortWithinSearchBands(scoped, search, sort) : sortAssignmentRooms(scoped, sort);

  let emptyReason: AssignmentEmptyReason = null;
  if (visible.length === 0 && rooms.length > 0) {
    if (matched.length > 0) emptyReason = "scope";
    else if (searching && searched.length === 0) emptyReason = "search";
    else emptyReason = "filters";
  }
  return { searching, filtering, total: rooms.length, matched, counts, visible, emptyReason };
}

function sortWithinSearchBands(rooms: readonly AssignmentRoom[], search: string, sort: AssignmentSortKey): AssignmentRoom[] {
  const needle = search.replace(/\s+/g, "").toLowerCase();
  const bandOf = (entry: AssignmentRoom) => {
    const number = entry.room.roomNumber.replace(/\s+/g, "").toLowerCase();
    return number === needle ? 0 : number.startsWith(needle) ? 1 : 2;
  };
  const bands: AssignmentRoom[][] = [[], [], []];
  for (const entry of rooms) bands[bandOf(entry)].push(entry);
  return bands.flatMap((band) => sortAssignmentRooms(band, sort));
}
