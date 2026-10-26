import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { NONE_KEY, toggleIn } from "@/lib/housekeeping/roomBoardFilters";
import { DEFAULT_ROOM_PRIORITY } from "@/lib/housekeeping/roomBoardModel";
import { searchQueue, type QueueItem } from "@/lib/inspections/queue";

/* ─── The To-inspect list: priority, filters, sort and search (pure) ─────────
   Everything the supervisor sees in the queue is derived here from the verified queue items and the hotel's clock.

   PRIORITY uses only RECORDED facts - never a prediction:
     overdue        the recorded guest arrival (or the recorded "needed by" time) is on the hotel's current date and
                    has passed while the room is still waiting
     arrival today  a guest arrival is recorded for the hotel's current date (an arrival is NOT a deadline)
     elevated       an explicit stored priority below the schema default of 5 (1 is highest)
     reinspection   the room is back after a failed inspection
     VIP            the VIP flag - a flag, not an emergency
     long wait      time since the housekeeper finished
   A time left over from another day is ignored, and a missing fact is "unknown", never "no".

   FILTER SEMANTICS: choices inside one category combine with OR; categories combine with AND. "Inspection type" is
   two independent questions shown together - initial/reinspection and departure/stayover - so picking one of each
   narrows the list instead of widening it. A filter with no data behind it is UNAVAILABLE: it is not applied and the
   drawer says why; it never reports a false zero.

   SORT is deterministic: every mode ends in the same location tie-break (building → floor → natural room number →
   room id), so two renders of the same data are never ordered differently. An unknown time sorts last, never first. */

export type PriorityFilter = "arrival" | "vip" | "overdue";
export type ReviewKind = "initial" | "reinspection";
export type CleanKind = "departure" | "stayover";
export type QueueSort = "priority" | "waiting" | "room" | "floor";

export const PRIORITY_FILTERS: readonly PriorityFilter[] = ["arrival", "vip", "overdue"];
export const REVIEW_KINDS: readonly ReviewKind[] = ["initial", "reinspection"];
export const CLEAN_KINDS: readonly CleanKind[] = ["departure", "stayover"];
export const QUEUE_SORTS: readonly QueueSort[] = ["priority", "waiting", "room", "floor"];
export const DEFAULT_QUEUE_SORT: QueueSort = "priority";

export interface QueueFilters {
  priority: PriorityFilter[];
  /** `floorKey`s (`building|floor`), so two buildings' floor 2 are never confused. */
  floors: string[];
  review: ReviewKind[];
  clean: CleanKind[];
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = { priority: [], floors: [], review: [], clean: [] };

/** Filters and sort as the drawer edits them. */
export interface QueueDraft {
  filters: QueueFilters;
  sort: QueueSort;
}

export const DEFAULT_QUEUE_DRAFT: QueueDraft = { filters: EMPTY_QUEUE_FILTERS, sort: DEFAULT_QUEUE_SORT };

export interface QueueContext {
  now: number;
  timeZone: string | null | undefined;
}

export function filterCount(filters: QueueFilters): number {
  return filters.priority.length + filters.floors.length + filters.review.length + filters.clean.length;
}

export function hasQueueFilters(filters: QueueFilters): boolean {
  return filterCount(filters) > 0;
}

/** Badge number for the filter button: applied filters plus a non-default sort. */
export function activeCount(draft: QueueDraft): number {
  return filterCount(draft.filters) + (draft.sort === DEFAULT_QUEUE_SORT ? 0 : 1);
}

export { toggleIn };

/* ─── Facts about one room ──────────────────────────────────────────────────── */

export function floorKeyOf(item: Pick<QueueItem, "building" | "floor">): string {
  return `${item.building ?? NONE_KEY}|${item.floor ?? NONE_KEY}`;
}

export function parseFloorKey(key: string): { building: string | null; floor: number | null } {
  const at = key.lastIndexOf("|");
  const building = key.slice(0, at);
  const floor = key.slice(at + 1);
  return { building: building === NONE_KEY ? null : building, floor: floor === NONE_KEY ? null : Number(floor) };
}

/** DEP = departure; FULL (linen change) and LIGHT service are stayover work. Anything else is unknown, not guessed. */
export function cleanKindOf(cleanType: string | null | undefined): CleanKind | null {
  switch ((cleanType ?? "").toUpperCase()) {
    case "DEP":
      return "departure";
    case "FULL":
    case "LIGHT":
    case "STAY":
      return "stayover";
    default:
      return null;
  }
}

export interface PriorityFacts {
  /** A guest arrival is recorded for the hotel's current date (past or still to come). */
  arrivalTodayMs: number | null;
  arrivalPassed: boolean;
  neededByPassed: boolean;
  overdue: boolean;
  /** A recorded arrival that has not happened yet. */
  arrivalUpcoming: boolean;
  elevatedPriority: number | null;
  reinspection: boolean;
  vip: boolean;
}

const todayKeys = new WeakMap<QueueContext, string | null>();

/** The hotel's current date, worked out once per clock reading rather than once per room. */
function todayKey(ctx: QueueContext): string | null {
  if (!todayKeys.has(ctx)) todayKeys.set(ctx, hotelDateKey(new Date(ctx.now), ctx.timeZone));
  return todayKeys.get(ctx) ?? null;
}

export function priorityFacts(item: QueueItem, ctx: QueueContext): PriorityFacts {
  const today = todayKey(ctx);
  const onToday = (ms: number | null): ms is number => ms !== null && today !== null && hotelDateKey(new Date(ms), ctx.timeZone) === today;
  const arrivalTodayMs = onToday(item.arrivalAtMs) ? item.arrivalAtMs : null;
  const arrivalPassed = arrivalTodayMs !== null && arrivalTodayMs <= ctx.now;
  const neededByPassed = onToday(item.neededByMs) && item.neededByMs <= ctx.now;
  return {
    arrivalTodayMs,
    arrivalPassed,
    neededByPassed,
    overdue: arrivalPassed || neededByPassed,
    arrivalUpcoming: arrivalTodayMs !== null && !arrivalPassed,
    elevatedPriority: item.priority !== null && item.priority < DEFAULT_ROOM_PRIORITY ? item.priority : null,
    reinspection: item.reinspection.isReinspection,
    vip: item.vip === true,
  };
}

/* ─── What can be filtered on ───────────────────────────────────────────────── */

export interface FloorOption {
  key: string;
  building: string | null;
  floor: number | null;
}

export interface QueueAvailability {
  priority: Record<PriorityFilter, boolean>;
  clean: Record<CleanKind, boolean>;
  floors: FloorOption[];
  /** Two or more buildings: floor labels then carry the building. */
  multiBuilding: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareFloorOptions(a: FloorOption, b: FloorOption): number {
  if (a.building !== b.building) {
    if (a.building === null) return 1;
    if (b.building === null) return -1;
    const byBuilding = collator.compare(a.building, b.building);
    if (byBuilding !== 0) return byBuilding;
  }
  if (a.floor !== b.floor) {
    if (a.floor === null) return 1;
    if (b.floor === null) return -1;
    return a.floor - b.floor;
  }
  return 0;
}

/** Reads the verified queue once. A flag with no data source is unavailable instead of "0 rooms". */
export function buildAvailability(items: readonly QueueItem[]): QueueAvailability {
  const priority: Record<PriorityFilter, boolean> = { arrival: false, vip: false, overdue: false };
  const clean: Record<CleanKind, boolean> = { departure: false, stayover: false };
  const floors = new Map<string, FloorOption>();
  const buildings = new Set<string>();
  for (const item of items) {
    if (item.arrivalAtMs !== null) {
      priority.arrival = true;
      priority.overdue = true;
    }
    if (item.neededByMs !== null) priority.overdue = true;
    if (item.vip !== null) priority.vip = true;
    const kind = cleanKindOf(item.cleanType);
    if (kind) clean[kind] = true;
    const key = floorKeyOf(item);
    if (!floors.has(key)) floors.set(key, { key, building: item.building, floor: item.floor });
    buildings.add(item.building ?? NONE_KEY);
  }
  return { priority, clean, floors: [...floors.values()].sort(compareFloorOptions), multiBuilding: buildings.size > 1 };
}

/** Applied filters whose data source is gone (so they cannot be honoured): reported, never silently dropped. */
export function unavailableApplied(filters: QueueFilters, availability: QueueAvailability): string[] {
  return [
    ...filters.priority.filter((key) => !availability.priority[key]).map((key) => `priority:${key}`),
    ...filters.clean.filter((key) => !availability.clean[key]).map((key) => `clean:${key}`),
  ];
}

/* ─── Filtering ─────────────────────────────────────────────────────────────── */

export function matchesFilters(item: QueueItem, filters: QueueFilters, availability: QueueAvailability, ctx: QueueContext): boolean {
  const priority = filters.priority.filter((key) => availability.priority[key]);
  if (priority.length > 0) {
    const facts = priorityFacts(item, ctx);
    const hit = priority.some((key) => (key === "arrival" ? facts.arrivalTodayMs !== null : key === "vip" ? facts.vip : facts.overdue));
    if (!hit) return false;
  }
  if (filters.floors.length > 0 && !filters.floors.includes(floorKeyOf(item))) return false;
  if (filters.review.length > 0 && !filters.review.some((kind) => (kind === "reinspection") === item.reinspection.isReinspection)) return false;
  const clean = filters.clean.filter((key) => availability.clean[key]);
  if (clean.length > 0) {
    const kind = cleanKindOf(item.cleanType);
    if (kind === null || !clean.includes(kind)) return false;
  }
  return true;
}

/* ─── Sorting ───────────────────────────────────────────────────────────────── */

function compareNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Building (none last) → floor (unknown last) → natural room number → room id. */
export function compareLocation(a: QueueItem, b: QueueItem): number {
  if (a.building !== b.building) {
    if (a.building === null) return 1;
    if (b.building === null) return -1;
    const byBuilding = collator.compare(a.building, b.building);
    if (byBuilding !== 0) return byBuilding;
  }
  if (a.floor !== b.floor) {
    if (a.floor === null) return 1;
    if (b.floor === null) return -1;
    return a.floor - b.floor;
  }
  return collator.compare(a.roomNumber, b.roomNumber) || a.roomId.localeCompare(b.roomId);
}

interface PriorityKey {
  overdue: number;
  elevated: number | null;
  arrival: number | null;
  reinspection: number;
  vip: number;
  waiting: number | null;
}

function priorityKey(item: QueueItem, ctx: QueueContext): PriorityKey {
  const facts = priorityFacts(item, ctx);
  return {
    overdue: facts.overdue ? 0 : 1,
    elevated: facts.elevatedPriority,
    arrival: facts.arrivalTodayMs,
    reinspection: facts.reinspection ? 0 : 1,
    vip: facts.vip ? 0 : 1,
    // The longest wait is the smallest "cleaned at"; an unknown clean time sorts last.
    waiting: item.cleanedAtMs,
  };
}

function comparePriorityKeys(a: PriorityKey, b: PriorityKey): number {
  return (
    a.overdue - b.overdue ||
    compareNullsLast(a.elevated, b.elevated) ||
    compareNullsLast(a.arrival, b.arrival) ||
    a.reinspection - b.reinspection ||
    a.vip - b.vip ||
    compareNullsLast(a.waiting, b.waiting)
  );
}

/** Sorts a copy. Priority keys are computed once per room, not once per comparison. */
export function sortQueue(items: readonly QueueItem[], sort: QueueSort, ctx: QueueContext): QueueItem[] {
  const keyed = items.map((item) => ({ item, key: sort === "priority" ? priorityKey(item, ctx) : null }));
  keyed.sort((a, b) => {
    let first = 0;
    if (sort === "priority") first = comparePriorityKeys(a.key as PriorityKey, b.key as PriorityKey);
    else if (sort === "waiting") first = compareNullsLast(a.item.cleanedAtMs, b.item.cleanedAtMs);
    else if (sort === "room") return collator.compare(a.item.roomNumber, b.item.roomNumber) || a.item.roomId.localeCompare(b.item.roomId);
    if (first !== 0) return first;
    return compareLocation(a.item, b.item);
  });
  return keyed.map((entry) => entry.item);
}

/* ─── The shown list ────────────────────────────────────────────────────────── */

export interface QueueSelection {
  /** Filtered, sorted, then search-ranked. */
  shown: QueueItem[];
  /** After filters, before search: the "of N" in "Showing 4 of 8 rooms". */
  filteredCount: number;
  totalCount: number;
}

export function selectQueue(input: {
  items: readonly QueueItem[];
  availability: QueueAvailability;
  filters: QueueFilters;
  sort: QueueSort;
  search: string;
  ctx: QueueContext;
}): QueueSelection {
  const { items, availability, filters, sort, search, ctx } = input;
  const filtered = hasQueueFilters(filters) ? items.filter((item) => matchesFilters(item, filters, availability, ctx)) : items;
  // Search ranks (exact → prefix → contains) over the chosen order, which each rank keeps.
  const shown = searchQueue(sortQueue(filtered, sort, ctx), search);
  return { shown, filteredCount: filtered.length, totalCount: items.length };
}

/** "Show N rooms": how many a draft would list, with the current search still applied. */
export function previewCount(input: Omit<Parameters<typeof selectQueue>[0], "filters" | "sort"> & { draft: QueueDraft }): number {
  const { draft, ...rest } = input;
  return selectQueue({ ...rest, filters: draft.filters, sort: draft.sort }).shown.length;
}

/* ─── Chips ─────────────────────────────────────────────────────────────────── */

export type QueueChip =
  | { id: string; kind: "priority"; key: PriorityFilter }
  | { id: string; kind: "floor"; floorKey: string; building: string | null; floor: number | null }
  | { id: string; kind: "review"; key: ReviewKind }
  | { id: string; kind: "clean"; key: CleanKind };

export function buildChips(filters: QueueFilters): QueueChip[] {
  return [
    ...filters.priority.map((key): QueueChip => ({ id: `priority:${key}`, kind: "priority", key })),
    ...filters.floors.map((floorKey): QueueChip => ({ id: `floor:${floorKey}`, kind: "floor", floorKey, ...parseFloorKey(floorKey) })),
    ...filters.review.map((key): QueueChip => ({ id: `review:${key}`, kind: "review", key })),
    ...filters.clean.map((key): QueueChip => ({ id: `clean:${key}`, kind: "clean", key })),
  ];
}

export function removeChip(filters: QueueFilters, chip: QueueChip): QueueFilters {
  switch (chip.kind) {
    case "priority":
      return { ...filters, priority: filters.priority.filter((key) => key !== chip.key) };
    case "floor":
      return { ...filters, floors: filters.floors.filter((key) => key !== chip.floorKey) };
    case "review":
      return { ...filters, review: filters.review.filter((key) => key !== chip.key) };
    case "clean":
      return { ...filters, clean: filters.clean.filter((key) => key !== chip.key) };
  }
}
