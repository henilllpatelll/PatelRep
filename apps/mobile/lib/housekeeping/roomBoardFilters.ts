import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { isUnassignedWork, urgentReasons } from "@/lib/housekeeping/roomBoardSelectors";
import type { SortContext } from "@/lib/housekeeping/roomBoardSort";

/* ─── Room Board — search and filters (pure) ────────────────────────────────
   One filtering system for the whole board, derived only from the verified `BoardRoom`s.

   SEMANTICS
     Within the STATUS category and within the FLOORS selection, choices combine with OR
       (To clean + Awaiting inspection = rooms in either).
     Every other filter is its own category, so ACROSS categories everything combines with AND
       (Status: To clean  +  Unassigned  +  Arrivals today  = rooms satisfying all three).
     Building narrows the floors on offer; a selected floor is `building|floor`, so floors of two buildings
       never get confused.
     Search is case-insensitive, ignores whitespace and matches room numbers only (never guests).

   HONESTY
     A filter whose data source is absent from the board (no arrival times at all, no readiness forecasts)
     is reported UNAVAILABLE and is not applied — it never silently returns a false zero. An unrecognised
     status is kept (its own "Unrecognized" status filter, and always inside All).
     "Arrivals / departures today" compare the recorded time with the HOTEL's date, not the phone's. */

/* ─── Filter state ────────────────────────────────────────────────────────── */

export type StatusFilterKey = "toClean" | "working" | "toInspect" | "ready" | "outOfOrder" | "outOfService" | "unrecognized";

export const STATUS_FILTERS: readonly StatusFilterKey[] = ["toClean", "working", "toInspect", "ready", "outOfOrder", "outOfService", "unrecognized"];

export type FlagFilterKey = "unassigned" | "arrivalsToday" | "departuresToday" | "vip" | "dnd" | "workOrder" | "urgent" | "risk";

export const FLAG_FILTERS: readonly FlagFilterKey[] = ["unassigned", "arrivalsToday", "departuresToday", "vip", "dnd", "workOrder", "urgent", "risk"];

/** The "no building" / "no floor" placeholder inside a floor key. */
export const NONE_KEY = "~";

export interface BoardFilters {
  statuses: StatusFilterKey[];
  flags: FlagFilterKey[];
  /** A building name, NONE_KEY for rooms with no building, or null for every building. */
  building: string | null;
  /** `floorKey`s. Empty = every floor of the selected building(s). */
  floors: string[];
}

export const EMPTY_FILTERS: BoardFilters = { statuses: [], flags: [], building: null, floors: [] };

export function floorKeyOf(room: Pick<BoardRoom, "building" | "floor" | "floorKnown">): string {
  return `${room.building ?? NONE_KEY}|${room.floorKnown ? room.floor : NONE_KEY}`;
}

export function filterCount(filters: BoardFilters): number {
  return filters.statuses.length + filters.flags.length + (filters.building !== null ? 1 : 0) + filters.floors.length;
}

export function hasFilters(filters: BoardFilters): boolean {
  return filterCount(filters) > 0;
}

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Choosing a building drops floors that belong to other buildings, so the selection can never contradict itself. */
export function selectBuilding(filters: BoardFilters, building: string | null): BoardFilters {
  const floors = building === null ? filters.floors : filters.floors.filter((key) => key.startsWith(`${building}|`));
  return { ...filters, building, floors };
}

/* ─── Chips ───────────────────────────────────────────────────────────────── */

export type FilterChip =
  | { id: string; kind: "status"; key: StatusFilterKey }
  | { id: string; kind: "flag"; key: FlagFilterKey }
  | { id: string; kind: "building"; building: string }
  | { id: string; kind: "floor"; floorKey: string; building: string | null; floor: number | null };

function parseFloorKey(key: string): { building: string | null; floor: number | null } {
  const at = key.lastIndexOf("|");
  const building = key.slice(0, at);
  const floor = key.slice(at + 1);
  return { building: building === NONE_KEY ? null : building, floor: floor === NONE_KEY ? null : Number(floor) };
}

export function buildFilterChips(filters: BoardFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const key of filters.statuses) chips.push({ id: `status:${key}`, kind: "status", key });
  for (const key of filters.flags) chips.push({ id: `flag:${key}`, kind: "flag", key });
  if (filters.building !== null) chips.push({ id: `building:${filters.building}`, kind: "building", building: filters.building });
  for (const floorKey of filters.floors) chips.push({ id: `floor:${floorKey}`, kind: "floor", floorKey, ...parseFloorKey(floorKey) });
  return chips;
}

export function removeChip(filters: BoardFilters, chip: FilterChip): BoardFilters {
  switch (chip.kind) {
    case "status":
      return { ...filters, statuses: filters.statuses.filter((key) => key !== chip.key) };
    case "flag":
      return { ...filters, flags: filters.flags.filter((key) => key !== chip.key) };
    case "building":
      return { ...filters, building: null };
    case "floor":
      return { ...filters, floors: filters.floors.filter((key) => key !== chip.floorKey) };
  }
}

/* ─── What the board can actually filter on ───────────────────────────────── */

export interface FilterAvailability {
  /** Flags whose data source is missing from this board. */
  unavailableFlags: ReadonlySet<FlagFilterKey>;
  /** An unrecognised status exists, so the "Unrecognized" status filter is worth offering. */
  hasUnrecognized: boolean;
  /** Distinct buildings (NONE_KEY for rooms without one). Two or more = show building selection. */
  buildings: string[];
  floors: { key: string; building: string | null; floor: number | null }[];
}

/**
 * Reads the verified inventory once. Arrival / departure filters need at least one recorded check-in /
 * check-out time on the board, and the readiness-risk filter needs at least one stored forecast; without
 * that source the filter is unavailable instead of "0 rooms".
 */
export function buildFilterAvailability(rooms: readonly BoardRoom[]): FilterAvailability {
  const unavailable = new Set<FlagFilterKey>(FLAG_FILTERS.filter((key) => key === "arrivalsToday" || key === "departuresToday" || key === "risk"));
  let hasUnrecognized = false;
  const buildings = new Set<string>();
  const floors = new Map<string, { key: string; building: string | null; floor: number | null }>();
  for (const room of rooms) {
    if (room.checkinTime) unavailable.delete("arrivalsToday");
    if (room.checkoutTime) unavailable.delete("departuresToday");
    if (room.prediction?.riskLevel) unavailable.delete("risk");
    if (room.statusInfo.stage === "unknown") hasUnrecognized = true;
    buildings.add(room.building ?? NONE_KEY);
    const key = floorKeyOf(room);
    if (!floors.has(key)) floors.set(key, { key, building: room.building, floor: room.floorKnown ? room.floor : null });
  }
  const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
  const sortedBuildings = [...buildings].sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const sortedFloors = [...floors.values()].sort((a, b) => {
    if (a.building !== b.building) {
      if (a.building === null) return 1;
      if (b.building === null) return -1;
      return a.building.localeCompare(b.building, undefined, { numeric: true });
    }
    return nullsLast(a.floor, b.floor);
  });
  return { unavailableFlags: unavailable, hasUnrecognized, buildings: sortedBuildings, floors: sortedFloors };
}

/** Floors on offer for the current building choice. */
export function floorsForBuilding(availability: FilterAvailability, building: string | null): FilterAvailability["floors"] {
  if (building === null) return availability.floors;
  return availability.floors.filter((floor) => (floor.building ?? NONE_KEY) === building);
}

/** Applied flags that cannot be evaluated on this board (and are therefore not applied). */
export function unavailableApplied(filters: BoardFilters, availability: FilterAvailability): FlagFilterKey[] {
  return filters.flags.filter((key) => availability.unavailableFlags.has(key));
}

/* ─── Evaluation ──────────────────────────────────────────────────────────── */

function statusMatches(room: BoardRoom, key: StatusFilterKey): boolean {
  const info = room.statusInfo;
  switch (key) {
    case "toClean":
      return info.stage === "to_clean";
    case "working":
      return info.stage === "in_progress";
    case "toInspect":
      return info.stage === "awaiting_inspection";
    case "ready":
      return info.stage === "guest_ready";
    case "outOfOrder":
      return info.unavailable === "OOO" || info.unavailable === "OUT_OF_ORDER";
    case "outOfService":
      return info.unavailable === "OUT_OF_SERVICE";
    case "unrecognized":
      return info.stage === "unknown";
  }
}

function onHotelDate(value: string | null, ctx: SortContext): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return false;
  const day = hotelDateKey(new Date(at), ctx.timeZone);
  return day !== null && day === hotelDateKey(new Date(ctx.now), ctx.timeZone);
}

function flagMatches(room: BoardRoom, key: FlagFilterKey, ctx: SortContext): boolean {
  switch (key) {
    case "unassigned":
      return isUnassignedWork(room);
    case "arrivalsToday":
      return onHotelDate(room.checkinTime, ctx);
    case "departuresToday":
      return onHotelDate(room.checkoutTime, ctx);
    case "vip":
      return room.vip;
    case "dnd":
      return room.dnd;
    case "workOrder":
      return room.workOrder !== null;
    case "urgent":
      return urgentReasons(room, ctx.now, ctx.timeZone).length > 0;
    case "risk":
      // A stored forecast says nothing about a room that is already guest-ready or out of service.
      return room.prediction?.riskLevel === "HIGH" && room.statusInfo.stage !== "guest_ready" && room.statusInfo.stage !== "unavailable";
  }
}

/** Does one room satisfy the filters? Unavailable flags are skipped (reported via `unavailableApplied`). */
export function roomMatchesFilters(room: BoardRoom, filters: BoardFilters, availability: FilterAvailability, ctx: SortContext): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.some((key) => statusMatches(room, key))) return false;
  for (const key of filters.flags) {
    if (availability.unavailableFlags.has(key)) continue;
    if (!flagMatches(room, key, ctx)) return false;
  }
  if (filters.building !== null && (room.building ?? NONE_KEY) !== filters.building) return false;
  if (filters.floors.length > 0 && !filters.floors.includes(floorKeyOf(room))) return false;
  return true;
}

export function applyFilters<T extends { room: BoardRoom }>(
  views: readonly T[],
  filters: BoardFilters,
  availability: FilterAvailability,
  ctx: SortContext,
): T[] {
  if (!hasFilters(filters)) return [...views];
  return views.filter((view) => roomMatchesFilters(view.room, filters, availability, ctx));
}

/* ─── Search ──────────────────────────────────────────────────────────────── */

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, "").toLowerCase();
}

/** 0 exact · 1 starts with · 2 contains · null no match. */
export function searchRank(roomNumber: string, normalizedQuery: string): 0 | 1 | 2 | null {
  const number = roomNumber.replace(/\s+/g, "").toLowerCase();
  if (number === normalizedQuery) return 0;
  if (number.startsWith(normalizedQuery)) return 1;
  return number.includes(normalizedQuery) ? 2 : null;
}

/** Matches in rank order (exact → prefix → contains), each rank in the caller's order. An empty query keeps everything. */
export function applySearch<T extends { room: BoardRoom }>(views: readonly T[], query: string): T[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...views];
  const ranked: T[][] = [[], [], []];
  for (const view of views) {
    const rank = searchRank(view.room.roomNumber, needle);
    if (rank !== null) ranked[rank].push(view);
  }
  return [...ranked[0], ...ranked[1], ...ranked[2]];
}

export function isSearching(query: string): boolean {
  return normalizeQuery(query).length > 0;
}
