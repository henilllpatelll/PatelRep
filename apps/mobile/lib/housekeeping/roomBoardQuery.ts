import {
  applyFilters,
  applySearch,
  hasFilters,
  isSearching,
  normalizeQuery,
  searchRank,
  unavailableApplied,
  type BoardFilters,
  type FilterAvailability,
  type FlagFilterKey,
} from "@/lib/housekeeping/roomBoardFilters";
import { buildBoardMetrics, groupByBuildingAndFloor, type BuildingGroupOf } from "@/lib/housekeeping/roomBoardSelectors";
import { isFlatSort, sortViews, type BoardSortKey, type SortContext } from "@/lib/housekeeping/roomBoardSort";
import type { BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import { inSegment, segmentCounts, type BoardSegmentKey } from "@/lib/housekeeping/roomBoardView";

/* ─── Room Board — the one query pipeline ───────────────────────────────────
   verified dataset → search → advanced filters → (segment counts) → status segment → sort → group → render.

   Segment counts are taken from the dataset AFTER search and filters but BEFORE the segment's own restriction,
   so the chips always add up to what the filters leave (and "All" is exactly that number). A filtered-out
   room is still on the board: deep links and the room sheet read the full dataset, never this result. */

/** A filtered result this small reads better as a plain list than as a sparse grid. */
export const LIST_THRESHOLD = 12;

/** The Filter & Sort drawer's selection: what is applied, or what is being edited before Apply. */
export interface FilterDraft {
  filters: BoardFilters;
  sort: BoardSortKey;
}

export type BoardLayout = "grid" | "list";

export type EmptyReason = "search" | "filters" | "segment" | null;

export interface BoardQueryInput {
  views: readonly BoardRoomView[];
  search: string;
  filters: BoardFilters;
  segment: BoardSegmentKey;
  sort: BoardSortKey;
  availability: FilterAvailability;
  ctx: SortContext;
}

export interface BoardQueryResult {
  searching: boolean;
  filtering: boolean;
  /** Rooms in the whole inventory. */
  inventory: number;
  /** Rooms matching the search alone (before filters). */
  searchMatches: number;
  /** Search + filters, before the segment. */
  matched: BoardRoomView[];
  counts: Record<BoardSegmentKey, number>;
  /** Segment applied and sorted: what the supervisor sees. */
  visible: BoardRoomView[];
  layout: BoardLayout;
  emptyReason: EmptyReason;
  /** Applied flags the board has no data for (not applied). */
  unavailableApplied: FlagFilterKey[];
}

/** Sorts within each search-rank band, so an exact room number is first whatever the sort mode. */
function sortSearchResults(matched: readonly BoardRoomView[], query: string, sort: BoardSortKey, ctx: SortContext): BoardRoomView[] {
  const needle = normalizeQuery(query);
  const bands: BoardRoomView[][] = [[], [], []];
  for (const view of matched) bands[searchRank(view.room.roomNumber, needle) ?? 2].push(view);
  return bands.flatMap((band) => sortViews(band, sort, ctx));
}

export function runBoardQuery(input: BoardQueryInput): BoardQueryResult {
  const { views, search, filters, segment, sort, availability, ctx } = input;
  const searching = isSearching(search);
  const filtering = hasFilters(filters);

  const searched = applySearch(views, search);
  const matched = applyFilters(searched, filters, availability, ctx);
  const counts = segmentCounts(buildBoardMetrics(matched.map((view) => view.room)));
  const segmented = segment === "all" ? matched : matched.filter((view) => inSegment(view.room.statusInfo.stage, segment));
  const visible = searching ? sortSearchResults(segmented, search, sort, ctx) : sortViews(segmented, sort, ctx);

  let emptyReason: EmptyReason = null;
  if (visible.length === 0 && views.length > 0) {
    if (matched.length > 0) emptyReason = "segment";
    else if (searching && searched.length === 0) emptyReason = "search";
    else emptyReason = "filters";
  }

  const layout: BoardLayout = searching || isFlatSort(sort) || (filtering && visible.length <= LIST_THRESHOLD) ? "list" : "grid";

  return {
    searching,
    filtering,
    inventory: views.length,
    searchMatches: searched.length,
    matched,
    counts,
    visible,
    layout,
    emptyReason,
    unavailableApplied: unavailableApplied(filters, availability),
  };
}

/* ─── Render items ────────────────────────────────────────────────────────── */

export type QueryItem =
  | { type: "building"; key: string; building: string | null }
  | { type: "floor"; key: string; building: string | null; floor: number | null; shown: number; total: number }
  | { type: "row"; key: string; views: BoardRoomView[]; columns: number }
  | { type: "result"; key: string; view: BoardRoomView };

function floorKeyFor(buildingKey: string, floor: number | null): string {
  return `f:${buildingKey}:${floor ?? "~"}`;
}

/** Floor totals over the FULL inventory, so a filtered floor can read "3 of 24". */
export function floorTotals(views: readonly BoardRoomView[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const group of groupByBuildingAndFloor(views)) {
    for (const floor of group.floors) totals.set(floorKeyFor(group.building ?? "~", floor.floor), floor.rooms.length);
  }
  return totals;
}

/** Buildings → floors → rows of `columns` rooms for a virtualised grid. The building heading shows only for a multi-building result. */
export function flattenGrid(
  groups: BuildingGroupOf<BoardRoomView>[],
  totals: ReadonlyMap<string, number>,
  columns: number,
): QueryItem[] {
  const perRow = Math.max(1, Math.floor(columns));
  const showBuildings = groups.length > 1;
  const items: QueryItem[] = [];
  for (const group of groups) {
    const buildingKey = group.building ?? "~";
    if (showBuildings) items.push({ type: "building", key: `b:${buildingKey}`, building: group.building });
    for (const floor of group.floors) {
      const key = floorKeyFor(buildingKey, floor.floor);
      items.push({ type: "floor", key, building: group.building, floor: floor.floor, shown: floor.rooms.length, total: totals.get(key) ?? floor.rooms.length });
      for (let index = 0; index < floor.rooms.length; index += perRow) {
        items.push({ type: "row", key: `${key}:r${index / perRow}`, views: floor.rooms.slice(index, index + perRow), columns: perRow });
      }
    }
  }
  return items;
}

export function buildQueryItems(result: BoardQueryResult, totals: ReadonlyMap<string, number>, columns: number): QueryItem[] {
  if (result.layout === "list") {
    return result.visible.map((view) => ({ type: "result", key: `r:${view.room.roomId}`, view }));
  }
  // Rooms are already in the chosen order; grouping keeps buildings/floors in order and the order inside each floor.
  return flattenGrid(groupByBuildingAndFloor(result.visible, "given"), totals, columns);
}

/* ─── Floor navigation ────────────────────────────────────────────────────── */

export interface FloorJump {
  key: string;
  /** Index of the floor heading in the rendered list. */
  index: number;
  building: string | null;
  floor: number | null;
  /** True when the board shows building headings, so the jump label names the building too. */
  buildingShown: boolean;
}

/** One jump target per floor heading. Only worth showing once there are several floors to scroll past. */
export function buildFloorJumps(items: readonly QueryItem[]): FloorJump[] {
  const buildingShown = items.some((item) => item.type === "building");
  const jumps: FloorJump[] = [];
  items.forEach((item, index) => {
    if (item.type === "floor") jumps.push({ key: item.key, index, building: item.building, floor: item.floor, buildingShown });
  });
  return jumps;
}

export const MIN_FLOORS_FOR_JUMP = 4;
