import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import { listWorkOrderPage, type WorkOrderPage } from "@/lib/api/workOrders";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import {
  emptyBucket,
  initialQueueState,
  queueReducer,
  type LoadMode,
  type QueueBucket,
} from "@/lib/engineering/workQueueState";
import {
  belongsToView,
  queueKey,
  type QueueView,
  type Viewer,
  type WorkOrderListParams,
} from "@/lib/engineering/workQueue";

/** A refresh re-reads at most this many pages, so a long scroll never turns into an unbounded reload. */
export const MAX_REFRESH_PAGES = 4;

interface Options {
  /** Hotel + person. When it changes (property switch, sign-out) nothing from the old scope is shown or applied. */
  scope: string;
  view: QueueView;
  params: WorkOrderListParams;
  viewer: Viewer;
  enabled: boolean;
  fetchPage?: (params: WorkOrderListParams, page: number) => Promise<WorkOrderPage>;
}

export interface WorkQueueHandle {
  key: string;
  bucket: QueueBucket;
  loadMore: () => void;
  /** Re-reads the pages already loaded and replaces them in place; resolves when it settles. */
  refresh: () => Promise<void>;
  /** Remove one order from the visible list (after a confirmed claim moved it elsewhere). */
  removeItem: (id: string) => void;
  /** Something changed that other views show: reload them the next time they are visited. */
  invalidateOthers: () => void;
}

/**
 * Loads one view of the Work queue page by page. Every request is tagged; a result applies only if it is still
 * the newest request for its key and the hotel/person has not changed, so a slow response can never overwrite a
 * newer one or leak rows across accounts.
 */
export function useWorkQueue({ scope, view, params, viewer, enabled, fetchPage = listWorkOrderPage }: Options): WorkQueueHandle {
  const [state, dispatch] = useReducer(queueReducer, scope, initialQueueState);
  const key = useMemo(() => queueKey(view, params), [view, params]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const scopeRef = useRef(scope);
  const tokens = useRef(new Map<string, number>());
  // onEndReached can fire several times before React re-renders, so "already loading more" is tracked synchronously.
  const moreInFlight = useRef(new Set<string>());
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    scopeRef.current = scope;
    tokens.current.clear();
    moreInFlight.current.clear();
    dispatch({ type: "reset", scope });
  }, [scope]);

  const run = useCallback(
    async (runKey: string, runView: QueueView, runParams: WorkOrderListParams, mode: LoadMode): Promise<void> => {
      const myScope = scopeRef.current;
      const token = (tokens.current.get(runKey) ?? 0) + 1;
      tokens.current.set(runKey, token);
      const current = () => scopeRef.current === myScope && tokens.current.get(runKey) === token;
      if (mode === "more") moreInFlight.current.add(runKey);
      const before = stateRef.current.buckets[runKey] ?? emptyBucket();

      dispatch({ type: "start", key: runKey, mode, now: Date.now() });
      try {
        const orders: WorkOrder[] = [];
        let hasMore = false;
        let pages = 0;
        if (mode === "more") {
          const result = await fetchRef.current(runParams, before.page + 1);
          orders.push(...result.orders);
          hasMore = result.hasMore;
          pages = 1;
        } else {
          const wanted = mode === "refresh" ? Math.min(Math.max(before.page, 1), MAX_REFRESH_PAGES) : 1;
          for (let page = 1; page <= wanted; page += 1) {
            const result = await fetchRef.current(runParams, page);
            orders.push(...result.orders);
            hasMore = result.hasMore;
            pages = page;
            if (!result.hasMore) break;
          }
        }
        if (!current()) return;
        dispatch({
          type: "success",
          key: runKey,
          mode,
          // The server filters; this keeps a stray row (an older API ignoring a filter) out of the wrong queue.
          orders: orders.filter((wo) => belongsToView(wo, runView, viewerRef.current)),
          pages,
          hasMore,
          now: Date.now(),
        });
      } catch (error) {
        if (!current()) return;
        dispatch({ type: "failure", key: runKey, failure: classifyLoadFailure(error) });
      } finally {
        if (mode === "more") moreInFlight.current.delete(runKey);
      }
    },
    []
  );

  // Until the scope reset lands, nothing from the previous hotel/person is shown.
  const bucket = state.scope === scope ? (state.buckets[key] ?? emptyBucket()) : emptyBucket();
  const needsFirstLoad = !bucket.loaded && !bucket.loading && bucket.failure == null;
  const needsRevalidate = bucket.loaded && bucket.stale && !bucket.refreshing && bucket.failure == null;

  useEffect(() => {
    if (!enabled) return;
    if (needsFirstLoad) void run(key, view, params, "initial");
    else if (needsRevalidate) void run(key, view, params, "refresh");
  }, [enabled, needsFirstLoad, needsRevalidate, key, view, params, run]);

  const loadMore = useCallback(() => {
    const b = stateRef.current.buckets[key];
    if (!b || !b.loaded || !b.hasMore || b.loadingMore || b.loading || b.refreshing || b.failure) return;
    if (moreInFlight.current.has(key)) return;
    void run(key, view, params, "more");
  }, [key, view, params, run]);

  const refresh = useCallback(() => run(key, view, params, "refresh"), [key, view, params, run]);

  const removeItem = useCallback((id: string) => dispatch({ type: "remove", key, id }), [key]);
  const invalidateOthers = useCallback(() => dispatch({ type: "invalidate", exceptKey: key }), [key]);

  return { key, bucket, loadMore, refresh, removeItem, invalidateOthers };
}
