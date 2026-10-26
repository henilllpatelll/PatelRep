import { NONE_KEY, floorKeyOf } from "@/lib/housekeeping/roomBoardFilters";
import { compareRoomNumbers } from "@/lib/housekeeping/roomBoardSelectors";
import type { AssignmentRoom } from "@/lib/housekeeping/assignmentModel";
import { comparePriority, type PriorityTier } from "@/lib/housekeeping/assignmentPriority";
import { isRemainingWork } from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — search, filter and sort ──────────────────────
   Pure. dataset → search → location/priority/type/status filters → (scope counts) → scope → sort.

   THE DATASET is the assignment QUEUE: in-service rooms still to clean or being cleaned
   (`queueOf`). Rooms already submitted, inspected or out of service are not assignment work and never
   appear here, whatever the filters say.

   The scopes: `unassigned` is unowned rooms that can be handed out as they stand; `assigned` is owned rooms;
   `blocked` is any room with a soft block (owned or not); `urgent` is a priority tier above routine. A held-back
   unowned room is therefore in `blocked` and not in `unassigned`, so the Unassigned chip and the header agree.

   Scope counts are taken AFTER search and the other filters but BEFORE the scope's own restriction, so the
   chips add up to what the filters leave and "All" is exactly that number. A filtered-out room is still on
   the board: deep links and detail sheets read the full dataset, never a query result.

   SEARCH looks at what a supervisor actually types: a room number, a floor ("floor 3"), a building, or the
   name of the person the room is assigned to. The phrase must match inside one field (or every word inside the person's
   name); a room-number match always ranks above a match on another field. Nothing here touches the network — it filters the verified dataset. */

export type AssignmentScope = "all" | "unassigned" | "assigned" | "urgent" | "blocked";

export const ASSIGNMENT_SCOPES: readonly AssignmentScope[] = ["all", "unassigned", "assigned", "urgent", "blocked"];

export type AssignmentSortKey = "priority" | "roomNumber" | "location" | "deadline";

/**
 * Priority as a filter axis, independent of the assignment scope so "unassigned AND urgent" is expressible.
 *   urgent    a priority tier above routine (the Phase 1 rule — recorded facts only)
 *   vip       the room is flagged VIP
 *   at_risk   a recorded arrival has already passed, or the stored readiness forecast says HIGH risk
 */
export type PriorityFilter = "any" | "urgent" | "vip" | "at_risk";

export interface AssignmentFilters {
  /** A building name, NONE_KEY for rooms with no building, or null for every building. */
  building: string | null;
  /** `floorKeyOf` keys. Empty = every floor of the selected building(s). */
  floors: string[];
  tiers: PriorityTier[];
  priority: PriorityFilter;
  /** `cleanTypeKeyOf` keys. Empty = every cleaning type. */
  cleanTypes: string[];
  /** Raw room status codes (DIRTY, PICKUP, …). Empty = every status. */
  statuses: string[];
}

export const EMPTY_ASSIGNMENT_FILTERS: AssignmentFilters = {
  building: null,
  floors: [],
  tiers: [],
  priority: "any",
  cleanTypes: [],
  statuses: [],
};

export function assignmentFilterCount(filters: AssignmentFilters): number {
  return (
    (filters.building !== null ? 1 : 0) +
    filters.floors.length +
    filters.tiers.length +
    (filters.priority !== "any" ? 1 : 0) +
    filters.cleanTypes.length +
    filters.statuses.length
  );
}

/** The rooms the Rooms tab works with: remaining work, in the model's priority order. */
export function queueOf(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => isRemainingWork(entry.room));
}

/* ─── Search ──────────────────────────────────────────────────────────────── */

/** Trimmed, whitespace-collapsed, lower-cased. */
export function normalizeSearch(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isSearchingFor(query: string): boolean {
  return normalizeSearch(query).length > 0;
}

/** 0 exact room number · 1 room number starts with · 2 room number contains · 3 matched another field · null no match. */
export type SearchRank = 0 | 1 | 2 | 3;

function searchFields(entry: AssignmentRoom): string[] {
  const { room, ownership } = entry;
  const fields = [room.roomNumber.toLowerCase()];
  if (room.floorKnown) fields.push(`floor ${room.floor}`);
  if (room.building) fields.push(`building ${room.building.toLowerCase()}`, room.building.toLowerCase());
  if (ownership.name) fields.push(ownership.name.toLowerCase());
  return fields;
}

export function searchRankOf(entry: AssignmentRoom, needle: string): SearchRank | null {
  const fields = searchFields(entry);
  // The whole phrase inside ONE field ("floor 2", "building b", "ana torres"), or every word inside the person's
  // name ("torres ana"). Words are never matched across different fields: "floor 2" must not find room 102.
  const name = entry.ownership.name?.toLowerCase() ?? null;
  const phrase = fields.some((field) => field.includes(needle));
  const nameWords = name !== null && needle.split(" ").every((word) => name.includes(word));
  if (!phrase && !nameWords) return null;
  const number = entry.room.roomNumber.replace(/\s+/g, "").toLowerCase();
  const compact = needle.replace(/\s+/g, "");
  if (number === compact) return 0;
  if (number.startsWith(compact)) return 1;
  if (number.includes(compact)) return 2;
  return 3;
}

/** Matches in rank order, each rank in the caller's order. An empty query keeps everything. */
export function searchAssignmentRooms(rooms: readonly AssignmentRoom[], query: string): AssignmentRoom[] {
  const needle = normalizeSearch(query);
  if (!needle) return [...rooms];
  const bands: AssignmentRoom[][] = [[], [], [], []];
  for (const entry of rooms) {
    const rank = searchRankOf(entry, needle);
    if (rank !== null) bands[rank].push(entry);
  }
  return bands.flat();
}

/* ─── Filters ─────────────────────────────────────────────────────────────── */

/** Key for rooms whose cleaning type is not recorded. */
export function cleanTypeKeyOf(entry: Pick<AssignmentRoom, "room">): string {
  return entry.room.cleanType ?? NONE_KEY;
}

function inScope(entry: AssignmentRoom, scope: AssignmentScope): boolean {
  switch (scope) {
    case "all":
      return true;
    case "unassigned":
      // Unowned AND nothing in the way — the same rooms the header's "Unassigned" counts. A held-back room
      // (DND, declined, return later, under way with no owner) is in "blocked", never mixed into this number.
      return entry.eligibility.autoAssignable;
    case "assigned":
      return entry.ownership.assigned;
    case "urgent":
      return entry.priority.tier !== "routine";
    case "blocked":
      return entry.eligibility.softBlocks.length > 0;
  }
}

function matchesPriority(entry: AssignmentRoom, priority: PriorityFilter): boolean {
  switch (priority) {
    case "any":
      return true;
    case "urgent":
      return entry.priority.tier !== "routine";
    case "vip":
      return entry.room.vip;
    case "at_risk":
      return entry.priority.reasons.includes("arrival_passed") || entry.priority.reasons.includes("high_risk");
  }
}

function matchesFilters(entry: AssignmentRoom, filters: AssignmentFilters): boolean {
  const { room } = entry;
  if (filters.building !== null && (room.building ?? NONE_KEY) !== filters.building) return false;
  if (filters.floors.length > 0 && !filters.floors.includes(floorKeyOf(room))) return false;
  if (filters.tiers.length > 0 && !filters.tiers.includes(entry.priority.tier)) return false;
  if (!matchesPriority(entry, filters.priority)) return false;
  if (filters.cleanTypes.length > 0 && !filters.cleanTypes.includes(cleanTypeKeyOf(entry))) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(room.statusInfo.raw)) return false;
  return true;
}

/* ─── What the dataset can actually be filtered on ────────────────────────── */

export interface CleanTypeOption {
  key: string;
  /** The label the backend sent, or the raw code; null for "not recorded" (the caller supplies words). */
  label: string | null;
}

export interface AssignmentFilterOptions {
  buildings: string[];
  floors: { key: string; building: string | null; floor: number | null }[];
  cleanTypes: CleanTypeOption[];
  /** Raw status codes present in the dataset, in a stable operational order. */
  statuses: string[];
  hasVip: boolean;
  hasAtRisk: boolean;
  /** At least one room has a recorded arrival today, so a deadline sort means something. */
  hasDeadline: boolean;
}

const STATUS_ORDER = ["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS"];

/** Reads the dataset once. Nothing is hard-coded: a building, floor or type nobody has is not offered. */
export function buildFilterOptions(rooms: readonly AssignmentRoom[]): AssignmentFilterOptions {
  const buildings = new Set<string>();
  const floors = new Map<string, { key: string; building: string | null; floor: number | null }>();
  const cleanTypes = new Map<string, CleanTypeOption>();
  const statuses = new Set<string>();
  let hasVip = false;
  let hasAtRisk = false;
  let hasDeadline = false;
  for (const entry of rooms) {
    const { room } = entry;
    buildings.add(room.building ?? NONE_KEY);
    const floorKey = floorKeyOf(room);
    if (!floors.has(floorKey)) floors.set(floorKey, { key: floorKey, building: room.building, floor: room.floorKnown ? room.floor : null });
    const typeKey = cleanTypeKeyOf(entry);
    if (!cleanTypes.has(typeKey)) cleanTypes.set(typeKey, { key: typeKey, label: room.cleanType === null ? null : (room.cleanTypeLabel ?? room.cleanType) });
    statuses.add(room.statusInfo.raw);
    if (room.vip) hasVip = true;
    if (matchesPriority(entry, "at_risk")) hasAtRisk = true;
    if (entry.priority.arrivalAt !== null) hasDeadline = true;
  }
  const nullsLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);
  const byBuilding = (a: string, b: string) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  return {
    buildings: [...buildings].sort(byBuilding),
    floors: [...floors.values()].sort((a, b) => {
      if (a.building !== b.building) return a.building === null ? 1 : b.building === null ? -1 : byBuilding(a.building, b.building);
      return nullsLast(a.floor, b.floor);
    }),
    cleanTypes: [...cleanTypes.values()].sort((a, b) => (a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))),
    statuses: [...statuses].sort((a, b) => {
      const ra = STATUS_ORDER.indexOf(a);
      const rb = STATUS_ORDER.indexOf(b);
      return (ra === -1 ? STATUS_ORDER.length : ra) - (rb === -1 ? STATUS_ORDER.length : rb) || a.localeCompare(b);
    }),
    hasVip,
    hasAtRisk,
    hasDeadline,
  };
}

/* ─── Sort ────────────────────────────────────────────────────────────────── */

function compareLocation(a: AssignmentRoom, b: AssignmentRoom): number {
  const nullsLast = (x: number | null, y: number | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y);
  if (a.room.building !== b.room.building) {
    if (a.room.building === null) return 1;
    if (b.room.building === null) return -1;
    return a.room.building.localeCompare(b.room.building, undefined, { numeric: true });
  }
  return nullsLast(a.room.floorKnown ? a.room.floor : null, b.room.floorKnown ? b.room.floor : null) || compareRoomNumbers(a.room, b.room);
}

/** Earliest recorded arrival first; a room with no recorded arrival after every room that has one; then priority. */
function compareDeadline(a: AssignmentRoom, b: AssignmentRoom): number {
  const x = a.priority.arrivalAt;
  const y = b.priority.arrivalAt;
  if (x !== y) {
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  }
  return comparePriority(a, b);
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
    case "deadline":
      return list.sort(compareDeadline);
  }
}

/* ─── The pipeline ────────────────────────────────────────────────────────── */

export interface AssignmentQueryInput {
  /** Normally `queueOf(model.rooms)`. */
  rooms: readonly AssignmentRoom[];
  search: string;
  filters: AssignmentFilters;
  scope: AssignmentScope;
  sort: AssignmentSortKey;
}

export type AssignmentEmptyReason = "search" | "filters" | "scope" | null;

/** The three quick views over the list. Each count is "what you would see if you pressed this chip". */
export type QuickView = "all" | "unassigned" | "urgent";
export const QUICK_VIEWS: readonly QuickView[] = ["all", "unassigned", "urgent"];

export interface AssignmentQueryResult {
  searching: boolean;
  filtering: boolean;
  /** Rooms in the dataset. */
  total: number;
  /** After search and filters, before the scope. */
  matched: AssignmentRoom[];
  counts: Record<AssignmentScope, number>;
  /** Counts behind the quick chips, honouring everything else that is applied. */
  quickCounts: Record<QuickView, number>;
  /** Scope applied and sorted: what the supervisor sees. A search keeps its rank bands first. */
  visible: AssignmentRoom[];
  emptyReason: AssignmentEmptyReason;
}

/** Whether a quick chip describes the current state. "Unassigned" and "Urgent" can both be on; "All" means neither is. */
export function isQuickActive(view: QuickView, state: { scope: AssignmentScope; priority: PriorityFilter }): boolean {
  switch (view) {
    case "all":
      return state.scope === "all" && state.priority === "any";
    case "unassigned":
      return state.scope === "unassigned";
    case "urgent":
      return state.priority === "urgent" || state.scope === "urgent";
  }
}

/** The scope and priority a quick chip turns ON, leaving search and every other filter alone. */
export function applyQuickView(view: QuickView, current: { scope: AssignmentScope; priority: PriorityFilter }): { scope: AssignmentScope; priority: PriorityFilter } {
  switch (view) {
    case "all":
      return { scope: "all", priority: "any" };
    case "unassigned":
      return { scope: "unassigned", priority: current.priority };
    case "urgent":
      return { scope: current.scope === "urgent" ? "all" : current.scope, priority: "urgent" };
  }
}

/** What pressing a quick chip does: turn it on, or (for Unassigned / Urgent) turn it off again. */
export function toggleQuickView(view: QuickView, state: { scope: AssignmentScope; priority: PriorityFilter }): { scope: AssignmentScope; priority: PriorityFilter } {
  if (view === "all" || !isQuickActive(view, state)) return applyQuickView(view, state);
  return view === "unassigned"
    ? { scope: "all", priority: state.priority }
    : { scope: state.scope === "urgent" ? "all" : state.scope, priority: "any" };
}

export function runAssignmentQuery(input: AssignmentQueryInput): AssignmentQueryResult {
  const { rooms, search, filters, scope, sort } = input;
  const searching = isSearchingFor(search);
  const filtering = assignmentFilterCount(filters) > 0;
  const searched = searchAssignmentRooms(rooms, search);
  const matched = searched.filter((entry) => matchesFilters(entry, filters));
  const counts = Object.fromEntries(ASSIGNMENT_SCOPES.map((key) => [key, matched.filter((entry) => inScope(entry, key)).length])) as Record<AssignmentScope, number>;

  const countWith = (nextScope: AssignmentScope, priority: PriorityFilter) =>
    searched.filter((entry) => matchesFilters(entry, { ...filters, priority }) && inScope(entry, nextScope)).length;
  const urgentView = applyQuickView("urgent", { scope, priority: filters.priority });
  const unassignedView = applyQuickView("unassigned", { scope, priority: filters.priority });
  const quickCounts: Record<QuickView, number> = {
    all: countWith("all", "any"),
    unassigned: countWith(unassignedView.scope, unassignedView.priority),
    urgent: countWith(urgentView.scope, urgentView.priority),
  };

  const scoped = matched.filter((entry) => inScope(entry, scope));
  // A search result keeps its rank bands (room number first, then other fields); the sort applies within each band.
  const visible = searching ? sortWithinSearchBands(scoped, search, sort) : sortAssignmentRooms(scoped, sort);

  let emptyReason: AssignmentEmptyReason = null;
  if (visible.length === 0 && rooms.length > 0) {
    if (matched.length > 0) emptyReason = "scope";
    else if (searching && searched.length === 0) emptyReason = "search";
    else emptyReason = "filters";
  }
  return { searching, filtering, total: rooms.length, matched, counts, quickCounts, visible, emptyReason };
}

function sortWithinSearchBands(rooms: readonly AssignmentRoom[], search: string, sort: AssignmentSortKey): AssignmentRoom[] {
  const needle = normalizeSearch(search);
  const bands: AssignmentRoom[][] = [[], [], [], []];
  for (const entry of rooms) bands[searchRankOf(entry, needle) ?? 3].push(entry);
  return bands.flatMap((band) => sortAssignmentRooms(band, sort));
}
