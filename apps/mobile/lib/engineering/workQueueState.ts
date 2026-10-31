/* ─── Work queue state ──────────────────────────────────────────────────────
   One bucket per view + request (view, filters and search together form its key), so switching views or
   returning from a detail screen never throws loaded rows away. Pure reducer: the hook owns request
   tokens and I/O, this owns what the lists look like after each result. */

import type { LoadFailure } from "@/lib/engineering/loadState";
import { dedupeById } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export interface QueueBucket {
  items: WorkOrder[];
  /** Pages loaded so far. */
  page: number;
  hasMore: boolean;
  /** At least one load has succeeded for this key. */
  loaded: boolean;
  /** First load with nothing to show yet. */
  loading: boolean;
  loadingMore: boolean;
  /** A refresh over rows that are already on screen. */
  refreshing: boolean;
  /** The latest attempt failed; items (if any) are from before it. */
  failure: LoadFailure | null;
  /** Something changed elsewhere (a claim, a realtime event): reload before trusting this. */
  stale: boolean;
  fetchedAt: number | null;
  touchedAt: number;
}

export interface QueueState {
  /** Hotel + person. A different scope never sees another's rows. */
  scope: string;
  buckets: Record<string, QueueBucket>;
}

export type LoadMode = "initial" | "refresh" | "more";

export type QueueAction =
  | { type: "reset"; scope: string }
  | { type: "start"; key: string; mode: LoadMode; now: number }
  | { type: "success"; key: string; mode: LoadMode; orders: WorkOrder[]; pages: number; hasMore: boolean; now: number }
  | { type: "failure"; key: string; failure: LoadFailure }
  | { type: "remove"; key: string; id: string }
  | { type: "invalidate"; exceptKey?: string };

export const MAX_BUCKETS = 20;

export function emptyBucket(now = 0): QueueBucket {
  return {
    items: [],
    page: 0,
    hasMore: false,
    loaded: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    failure: null,
    stale: false,
    fetchedAt: null,
    touchedAt: now,
  };
}

export const initialQueueState = (scope = ""): QueueState => ({ scope, buckets: {} });

/** Keeps the cache bounded while someone types a search: drop the least recently used, never the one in use. */
function trim(buckets: Record<string, QueueBucket>, keep: string): Record<string, QueueBucket> {
  const keys = Object.keys(buckets);
  if (keys.length <= MAX_BUCKETS) return buckets;
  const drop = keys
    .filter((key) => key !== keep)
    .sort((a, b) => buckets[a].touchedAt - buckets[b].touchedAt)
    .slice(0, keys.length - MAX_BUCKETS);
  const next = { ...buckets };
  for (const key of drop) delete next[key];
  return next;
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "reset":
      return state.scope === action.scope ? state : initialQueueState(action.scope);

    case "start": {
      const bucket = state.buckets[action.key] ?? emptyBucket(action.now);
      const next: QueueBucket = {
        ...bucket,
        touchedAt: action.now,
        failure: action.mode === "more" ? bucket.failure : null,
        loading: action.mode === "initial" && !bucket.loaded,
        refreshing: action.mode === "refresh" || (action.mode === "initial" && bucket.loaded),
        loadingMore: action.mode === "more",
      };
      return { ...state, buckets: trim({ ...state.buckets, [action.key]: next }, action.key) };
    }

    case "success": {
      const bucket = state.buckets[action.key] ?? emptyBucket(action.now);
      // Paging appends; a first load or refresh replaces. Either way an id appears once.
      const items = action.mode === "more" ? dedupeById([...bucket.items, ...action.orders]) : dedupeById(action.orders);
      return {
        ...state,
        buckets: {
          ...state.buckets,
          [action.key]: {
            ...bucket,
            items,
            page: action.mode === "more" ? bucket.page + action.pages : action.pages,
            hasMore: action.hasMore,
            loaded: true,
            loading: false,
            loadingMore: false,
            refreshing: false,
            failure: null,
            stale: false,
            fetchedAt: action.now,
            touchedAt: action.now,
          },
        },
      };
    }

    case "failure": {
      const bucket = state.buckets[action.key];
      if (!bucket) return state;
      return {
        ...state,
        buckets: {
          ...state.buckets,
          [action.key]: { ...bucket, loading: false, loadingMore: false, refreshing: false, failure: action.failure },
        },
      };
    }

    case "remove": {
      const bucket = state.buckets[action.key];
      if (!bucket) return state;
      return {
        ...state,
        buckets: { ...state.buckets, [action.key]: { ...bucket, items: bucket.items.filter((wo) => wo.id !== action.id) } },
      };
    }

    case "invalidate": {
      const buckets: Record<string, QueueBucket> = {};
      for (const [key, bucket] of Object.entries(state.buckets)) {
        buckets[key] = key === action.exceptKey ? bucket : { ...bucket, stale: true };
      }
      return { ...state, buckets };
    }

    default:
      return state;
  }
}
