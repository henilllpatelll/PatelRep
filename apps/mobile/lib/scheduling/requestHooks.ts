import { useCallback, useEffect, useRef, useState } from "react";
import { classifyRequestFailure, type RequestFailure } from "@/lib/api/schedulingRequests";

/* Two small hooks the Phase 5 screens share.
   `useRemote` loads one thing from the server and keeps the last good answer when a refresh fails (marked `failed`, never
   silently empty). `useRequestAction` runs ONE write at a time and keeps its failure in words until the person moves on. */

export type RemoteStatus = "loading" | "ready" | "failed";

export interface Remote<T> {
  data: T | null;
  status: RemoteStatus;
  /** A refresh is in flight while `data` is still the previous answer. */
  refreshing: boolean;
  failure: RequestFailure | null;
  refresh: () => Promise<void>;
}

export function useRemote<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true): Remote<T> {
  const [loaded, setLoaded] = useState<{ key: string; value: T } | null>(null);
  const [status, setStatus] = useState<RemoteStatus>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  const loader = useRef(load);
  loader.current = load;
  // An answer belongs to the inputs it was asked for: after the filter changes, the old list is not shown as the new one.
  const key = JSON.stringify(deps);
  const keyRef = useRef(key);
  keyRef.current = key;
  const data = loaded && loaded.key === key ? loaded.value : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const asked = keyRef.current;
    setRefreshing(true);
    try {
      const next = await loader.current();
      if (mine !== seq.current || !mounted.current) return;
      setLoaded({ key: asked, value: next });
      setStatus("ready");
      setFailure(null);
    } catch (caught) {
      if (mine !== seq.current || !mounted.current) return;
      setFailure(classifyRequestFailure(caught));
      setStatus("failed");
    } finally {
      if (mine === seq.current && mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setStatus("loading");
    void refresh();
  }, [enabled, refresh, ...deps]);

  return { data, status: data ? (failure ? "failed" : "ready") : status, refreshing, failure, refresh };
}

export interface RequestAction {
  busy: boolean;
  failure: RequestFailure | null;
  /** Runs `job` unless one is already running. Returns its result, or null when it failed (see `failure`). */
  run: <T>(job: () => Promise<T>, onStale?: () => void) => Promise<T | null>;
  clear: () => void;
}

export function useRequestAction(): RequestAction {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(job: () => Promise<T>, onStale?: () => void): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      return await job();
    } catch (caught) {
      const classified = classifyRequestFailure(caught);
      if (mounted.current) setFailure(classified);
      if (classified.stale) onStale?.();
      return null;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, failure, run, clear: useCallback(() => setFailure(null), []) };
}
