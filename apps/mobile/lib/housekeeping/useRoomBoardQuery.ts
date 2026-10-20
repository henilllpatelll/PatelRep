import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import type { FlatList } from "react-native";
import {
  EMPTY_FILTERS,
  buildFilterAvailability,
  buildFilterChips,
  filterCount,
  type BoardFilters,
  type FilterAvailability,
  type FilterChip,
} from "@/lib/housekeeping/roomBoardFilters";
import {
  buildFloorJumps,
  buildQueryItems,
  floorTotals,
  runBoardQuery,
  type BoardQueryResult,
  type FilterDraft,
  type FloorJump,
  type QueryItem,
} from "@/lib/housekeeping/roomBoardQuery";
import { DEFAULT_SORT, type BoardSortKey } from "@/lib/housekeeping/roomBoardSort";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView } from "@/lib/housekeeping/roomBoardState";
import {
  buildResultRowModel,
  buildTileModel,
  type BoardSegmentKey,
  type ResultRowModel,
  type RoomTileModel,
} from "@/lib/housekeeping/roomBoardView";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface RoomBoardQueryView {
  search: string;
  setSearch: (text: string) => void;
  clearSearch: () => void;
  filters: BoardFilters;
  setFilters: (update: BoardFilters | ((current: BoardFilters) => BoardFilters)) => void;
  clearFilters: () => void;
  sort: BoardSortKey;
  /** The applied filters + sort as the drawer's starting draft. */
  applied: FilterDraft;
  applyDraft: (draft: FilterDraft) => void;
  availability: FilterAvailability;
  query: BoardQueryResult;
  chips: FilterChip[];
  /** Applied filters plus a non-default sort; drives the filter button's badge. */
  activeBadge: number;
  items: QueryItem[];
  floorJumps: FloorJump[];
  tileModels: Map<string, RoomTileModel>;
  resultModels: Map<string, ResultRowModel>;
  listRef: RefObject<FlatList<QueryItem> | null>;
  jumpToFloor: (jump: FloorJump) => void;
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
}

/**
 * The Room Board's search / filter / sort state and everything derived from it, in one place.
 * State lives here (not in the data hook), so a routine refresh or realtime update never resets what the
 * supervisor chose; the derived result is recomputed from the newest verified rooms each time.
 */
export function useRoomBoardQuery({
  views,
  rooms,
  segment,
  columns,
  now,
  timeZone,
  language,
  t,
}: {
  views: readonly BoardRoomView[] | null;
  rooms: readonly BoardRoom[];
  segment: BoardSegmentKey;
  columns: number;
  now: number;
  timeZone: string;
  language: string;
  t: Translate;
}): RoomBoardQueryView {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<BoardSortKey>(DEFAULT_SORT);
  const listRef = useRef<FlatList<QueryItem> | null>(null);

  const availability = useMemo(() => buildFilterAvailability(rooms), [rooms]);
  const query = useMemo(
    () => runBoardQuery({ views: views ?? [], search, filters, segment, sort, availability, ctx: { now, timeZone } }),
    [views, search, filters, segment, sort, availability, now, timeZone],
  );
  const totals = useMemo(() => floorTotals(views ?? []), [views]);
  const items = useMemo(() => buildQueryItems(query, totals, columns), [query, totals, columns]);
  const floorJumps = useMemo(() => (query.layout === "grid" ? buildFloorJumps(items) : []), [query.layout, items]);

  // Only the layout in use is built: tiles for the grouped grid, rows for a list.
  const tileModels = useMemo(() => {
    const byId = new Map<string, RoomTileModel>();
    if (query.layout !== "grid") return byId;
    for (const view of query.visible) byId.set(view.room.roomId, buildTileModel(view, { now, timeZone, language, t }));
    return byId;
  }, [query.layout, query.visible, now, timeZone, language, t]);
  const resultModels = useMemo(() => {
    const byId = new Map<string, ResultRowModel>();
    if (query.layout !== "list") return byId;
    for (const view of query.visible) byId.set(view.room.roomId, buildResultRowModel(view, { now, timeZone, language, t }));
    return byId;
  }, [query.layout, query.visible, now, timeZone, language, t]);

  const chips = useMemo(() => buildFilterChips(filters), [filters]);
  const applied = useMemo<FilterDraft>(() => ({ filters, sort }), [filters, sort]);
  const applyDraft = useCallback((draft: FilterDraft) => {
    setFilters(draft.filters);
    setSort(draft.sort);
  }, []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const clearSearch = useCallback(() => setSearch(""), []);

  // Rows have different heights, so if the list has not measured that far yet, jump close by estimate first and then land exactly.
  const jumpToFloor = useCallback((jump: FloorJump) => {
    listRef.current?.scrollToIndex({ index: jump.index, animated: true, viewPosition: 0 });
  }, []);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 }), 120);
  }, []);

  return {
    search,
    setSearch,
    clearSearch,
    filters,
    setFilters,
    clearFilters,
    sort,
    applied,
    applyDraft,
    availability,
    query,
    chips,
    activeBadge: filterCount(filters) + (sort !== DEFAULT_SORT ? 1 : 0),
    items,
    floorJumps,
    tileModels,
    resultModels,
    listRef,
    jumpToFloor,
    onScrollToIndexFailed,
  };
}
