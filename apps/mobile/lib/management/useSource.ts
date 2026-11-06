import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";

/* One read-only data source for a dashboard tile group. Honest about its own state: a source is never "empty" or
   "zero" until it has actually answered, a failed source keeps its last good data (marked stale) instead of turning
   into zeros, and a late answer from an older request can never overwrite a newer one. Reads only: nothing here writes. */

export type SourceStatus = "idle" | "loading" | "ready" | "error";

export interface SourceState<T> {
  status: SourceStatus;
  data: T | null;
  /** When `data` was last fetched successfully (ms), or null. */
  fetchedAt: number | null;
  /** The last refresh failed but earlier data is still shown. */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useSource<T>(loader: () => Promise<T>, enabled = true): SourceState<T> {
  const isOnline = useAppStore((s) => s.isOnline);
  const [state, setState] = useState<Omit<SourceState<T>, "refresh">>({ status: "idle", data: null, fetchedAt: null, stale: false });
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !isOnline) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, status: s.data === null ? "loading" : s.status }));
    try {
      const data = await loaderRef.current();
      if (!mounted.current || mine !== seq.current) return;
      setState({ status: "ready", data, fetchedAt: Date.now(), stale: false });
    } catch {
      if (!mounted.current || mine !== seq.current) return;
      setState((s) => ({ ...s, status: s.data === null ? "error" : "ready", stale: s.data !== null }));
    }
  }, [enabled, isOnline]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
