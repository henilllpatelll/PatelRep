import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browseAssets } from "@/lib/api/assets";
import { assetBrowseKey, mergeAssetPages, type AssetFilters, type AssetPage, type AssetRow } from "@/lib/engineering/assetModel";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";

export interface AssetBrowse {
  rows: AssetRow[];
  total: number;
  hasMore: boolean;
  /** First page in flight with nothing to show. */
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  /** The latest attempt failed. `rows` (if any) are from before it, so the screen says they may be out of date. */
  failure: LoadFailure | null;
  /** At least one read has succeeded for these filters. A failed read before that is an error, never "no assets". */
  loaded: boolean;
  syncedAt: Date | null;
  loadMore: () => void;
  refresh: () => Promise<void>;
  retry: () => void;
}

interface Bucket {
  rows: AssetRow[];
  page: number;
  hasMore: boolean;
  total: number;
  syncedAt: Date;
}

/** Last good pages per hotel + person + request, so coming back from an asset shows the list where it was. */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 12;

/** For tests and sign-out. */
export function resetAssetBrowseCache(): void {
  buckets.clear();
  views.clear();
  listStale = false;
}

/** The search text and filters the person last had on screen, per hotel + person, so returning to the list lands where they were. */
const views = new Map<string, { filters: AssetFilters; text: string }>();

export function recallAssetView(scope: string | null): { filters: AssetFilters; text: string } | null {
  return scope ? views.get(scope) ?? null : null;
}

export function rememberAssetView(scope: string | null, view: { filters: AssetFilters; text: string }): void {
  if (scope) views.set(scope, view);
}

let listStale = false;

/** Something changed an asset's maintenance picture (a work order opened, a signal handled): the list refreshes when next shown. */
export function markAssetListStale(): void {
  listStale = true;
}

/** True once per change; the list screen calls it when it regains focus. */
export function takeAssetListStale(): boolean {
  const was = listStale;
  listStale = false;
  return was;
}

/**
 * An asset this person already loaded in this hotel, matched by id or exact tag. Only the caller's own scope is
 * searched, so a different account or property on the same device can never open another's equipment.
 */
export function findCachedAsset(scope: string | null, code: { kind: "id" | "tag"; value: string }): { id: string; name: string; asset_tag?: string | null } | null {
  if (!scope) return null;
  for (const [key, bucket] of buckets) {
    if (!key.startsWith(`${scope}|`)) continue;
    const hit = bucket.rows.find((row) => (code.kind === "id" ? row.id.toLowerCase() === code.value : row.asset_tag?.trim() === code.value));
    if (hit) return { id: hit.id, name: hit.name, asset_tag: hit.asset_tag };
  }
  return null;
}

interface Options {
  scope: string | null;
  filters: AssetFilters;
  /** The settled search text (already debounced). */
  query: string;
  enabled?: boolean;
  fetchPage?: (filters: AssetFilters, query: string, page: number, signal: AbortSignal) => Promise<AssetPage>;
}

/**
 * Pages the property inventory for one search + filter combination. Every request is tagged: an answer applies only
 * if it is still the newest for its key and the hotel/person has not changed, a new search cancels the old one, and
 * a page is merged by id so a row can never appear twice.
 */
export function useAssetBrowse({ scope, filters, query, enabled = true, fetchPage = browseAssets }: Options): AssetBrowse {
  const key = useMemo(() => (scope ? `${scope}|${assetBrowseKey(filters, query)}` : null), [scope, filters, query]);
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
          rows: mode === "more" && current ? mergeAssetPages(current.rows, result.rows) : result.rows,
          page,
          hasMore: result.hasMore,
          total: result.total,
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
