import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRoomBoard } from "@/lib/api/engineeringRooms";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import {
  mergeRoomPages,
  roomBoardKey,
  roomBoardParams,
  type RoomBoardCounts,
  type RoomBoardPage,
  type RoomBoardRow,
  type RoomFilters,
} from "@/lib/engineering/roomModel";

export interface RoomBoard {
  rows: RoomBoardRow[];
  total: number;
  hasMore: boolean;
  /** Whole-hotel counts for the quick chips (null until a read has succeeded). */
  counts: RoomBoardCounts | null;
  floors: number[];
  buildings: string[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  /** The latest attempt failed. `rows` (if any) are from before it, so the screen says they may be out of date. */
  failure: LoadFailure | null;
  /** At least one read has succeeded for these filters. A failed read before that is an error, never "no rooms". */
  loaded: boolean;
  syncedAt: Date | null;
  loadMore: () => void;
  refresh: () => Promise<void>;
  retry: () => void;
}

interface Bucket {
  rows: RoomBoardRow[];
  page: number;
  hasMore: boolean;
  total: number;
  counts: RoomBoardCounts | null;
  floors: number[];
  buildings: string[];
  syncedAt: Date;
}

/** Last good pages per hotel + person + request, so coming back from a room shows the list where it was. */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 12;
/** The search text and filters the person last had on screen, per hotel + person. */
const views = new Map<string, { filters: RoomFilters; text: string }>();
let listStale = false;

/** For tests and sign-out. */
export function resetRoomBoardCache(): void {
  buckets.clear();
  views.clear();
  listStale = false;
}

export function recallRoomView(scope: string | null): { filters: RoomFilters; text: string } | null {
  return scope ? views.get(scope) ?? null : null;
}

export function rememberRoomView(scope: string | null, view: { filters: RoomFilters; text: string }): void {
  if (scope) views.set(scope, view);
}

/** A repair or availability change happened elsewhere: the board refreshes when next shown. */
export function markRoomBoardStale(): void {
  listStale = true;
}

export function takeRoomBoardStale(): boolean {
  const was = listStale;
  listStale = false;
  return was;
}

interface Options {
  scope: string | null;
  filters: RoomFilters;
  /** The settled search text (already debounced). */
  query: string;
  enabled?: boolean;
  fetchPage?: (filters: RoomFilters, query: string, page: number, signal: AbortSignal) => Promise<RoomBoardPage>;
}

const defaultFetch = (filters: RoomFilters, query: string, page: number, signal: AbortSignal) =>
  fetchRoomBoard(roomBoardParams(filters, query), page, signal);

/**
 * Pages the whole hotel for one search + filter combination. Every request is tagged: an answer applies only if it is
 * still the newest for its key and the hotel/person has not changed, a new search cancels the old one, and a page is
 * merged by id so a room can never appear twice.
 */
export function useRoomBoard({ scope, filters, query, enabled = true, fetchPage = defaultFetch }: Options): RoomBoard {
  const key = useMemo(() => (scope ? `${scope}|${roomBoardKey(filters, query)}` : null), [scope, filters, query]);
  const [bucket, setBucket] = useState<Bucket | null>(() => (key ? buckets.get(key) ?? null : null));
  const [loading, setLoading] = useState(enabled && !!key && !(key && buckets.get(key)));
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  const ticket = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const inputs = useRef({ filters, query, fetchPage });
  inputs.current = { filters, query, fetchPage };
  const controller = useRef<AbortController | null>(null);
  const moreInFlight = useRef(false);
  const bucketRef = useRef(bucket);
  bucketRef.current = bucket;

  const store = useCallback((requestKey: string, next: Bucket) => {
    buckets.delete(requestKey);
    buckets.set(requestKey, next);
    while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string);
  }, []);

  const read = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      const requestKey = keyRef.current;
      if (!requestKey) return;
      const mine = ++ticket.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const current = bucketRef.current;
      const page = mode === "more" ? (current?.page ?? 0) + 1 : 1;
      if (mode === "more") setLoadingMore(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const result = await inputs.current.fetchPage(inputs.current.filters, inputs.current.query, page, abort.signal);
        if (mine !== ticket.current || requestKey !== keyRef.current) return;
        const next: Bucket = {
          rows: mode === "more" && current ? mergeRoomPages(current.rows, result.rows) : result.rows,
          page,
          hasMore: result.hasMore,
          total: result.total,
          counts: result.counts ?? current?.counts ?? null,
          floors: result.floors.length ? result.floors : current?.floors ?? [],
          buildings: result.buildings.length ? result.buildings : current?.buildings ?? [],
          syncedAt: new Date(),
        };
        store(requestKey, next);
        setBucket(next);
        setFailure(null);
      } catch (err) {
        if (mine !== ticket.current || requestKey !== keyRef.current || abort.signal.aborted) return;
        setFailure(classifyLoadFailure(err));
      } finally {
        if (mine === ticket.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
          moreInFlight.current = false;
        }
      }
    },
    [store],
  );

  useEffect(() => {
    const cached = key ? buckets.get(key) ?? null : null;
    setBucket(cached);
    setFailure(null);
    setLoadingMore(false);
    moreInFlight.current = false;
    if (!enabled || !key) {
      ticket.current += 1;
      controller.current?.abort();
      setLoading(false);
      return;
    }
    setLoading(!cached);
    void read(cached ? "refresh" : "initial");
    return () => {
      ticket.current += 1;
      controller.current?.abort();
    };
  }, [key, enabled, read]);

  const loadMore = useCallback(() => {
    const current = bucketRef.current;
    // onEndReached can fire several times before React re-renders: the guard is synchronous.
    if (!current?.hasMore || moreInFlight.current) return;
    moreInFlight.current = true;
    void read("more");
  }, [read]);

  const refresh = useCallback(() => read("refresh"), [read]);
  const retry = useCallback(() => {
    setLoading(!bucketRef.current);
    void read(bucketRef.current ? "refresh" : "initial");
  }, [read]);

  return {
    rows: bucket?.rows ?? [],
    total: bucket?.total ?? 0,
    hasMore: bucket?.hasMore ?? false,
    counts: bucket?.counts ?? null,
    floors: bucket?.floors ?? [],
    buildings: bucket?.buildings ?? [],
    loading,
    loadingMore,
    refreshing,
    failure,
    loaded: bucket != null,
    syncedAt: bucket?.syncedAt ?? null,
    loadMore,
    refresh,
    retry,
  };
}
