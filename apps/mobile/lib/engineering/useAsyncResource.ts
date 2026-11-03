import { useCallback, useEffect, useRef, useState } from "react";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";

export interface AsyncResource<T> {
  data: T | null;
  /** First read in flight with nothing to show. */
  loading: boolean;
  refreshing: boolean;
  failure: LoadFailure | null;
  /** HTTP status of the latest failure (404 = gone, 403 = not allowed). */
  status: number | null;
  /** When `data` was last read from the server. */
  syncedAt: Date | null;
  reload: () => Promise<void>;
}

interface Options {
  /** Hotel + person. A different scope never sees another's cached answer. */
  scope: string | null;
  /** Identity of what is being read; changing it starts a fresh read. */
  key: string;
  /** False defers the read (a section the person has not opened yet). */
  enabled?: boolean;
}

const cache = new Map<string, { data: unknown; syncedAt: Date }>();
const watchers = new Map<string, Set<(data: unknown, at: Date) => void>>();

/**
 * Replace the cached answer for a scope + key with data the server just confirmed (a saved edit), and update any
 * screen already showing it, so the change is visible at once instead of after the next read.
 */
export function primeAsyncResource(scope: string | null, key: string, data: unknown): void {
  if (!scope) return;
  const cacheKey = `${scope}|${key}`;
  const at = new Date();
  cache.set(cacheKey, { data, syncedAt: at });
  watchers.get(cacheKey)?.forEach((notify) => notify(data, at));
}

/** For tests and sign-out. */
export function resetAsyncResourceCache(): void {
  cache.clear();
}

/**
 * One server read with the engineering guarantees: it only applies if it is still the newest request for the current
 * scope + key (a slow answer for a previous asset or account is dropped), a failed refresh keeps the last good data
 * and reports the failure instead of an empty state, and the last good answer for a scope + key is reused on return.
 */
export function useAsyncResource<T>(load: (signal: AbortSignal) => Promise<T>, { scope, key, enabled = true }: Options): AsyncResource<T> {
  const cacheKey = scope ? `${scope}|${key}` : null;
  const initial = cacheKey ? cache.get(cacheKey) : undefined;
  const [data, setData] = useState<T | null>((initial?.data as T | undefined) ?? null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(initial?.syncedAt ?? null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled && !initial);
  const [refreshing, setRefreshing] = useState(false);
  const ticket = useRef(0);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const loadRef = useRef(load);
  loadRef.current = load;
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (mode: "initial" | "refresh") => {
    const mine = ++ticket.current;
    const requestKey = cacheKeyRef.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    if (!requestKey) {
      setLoading(false);
      return;
    }
    if (mode === "refresh") setRefreshing(true);
    try {
      const next = await loadRef.current(abort.signal);
      if (mine !== ticket.current || requestKey !== cacheKeyRef.current) return;
      const at = new Date();
      cache.set(requestKey, { data: next, syncedAt: at });
      setData(next);
      setSyncedAt(at);
      setFailure(null);
      setStatus(null);
    } catch (err) {
      if (mine !== ticket.current || requestKey !== cacheKeyRef.current || abort.signal.aborted) return;
      setFailure(classifyLoadFailure(err));
      const code = (err as { status?: unknown } | null)?.status;
      setStatus(typeof code === "number" ? code : null);
    } finally {
      if (mine === ticket.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const cached = cacheKey ? cache.get(cacheKey) : undefined;
    setData((cached?.data as T | undefined) ?? null);
    setSyncedAt(cached?.syncedAt ?? null);
    setFailure(null);
    setStatus(null);
    if (!enabled || !cacheKey) {
      ticket.current += 1;
      controller.current?.abort();
      setLoading(false);
      return;
    }
    setLoading(!cached);
    void run("initial");
    return () => {
      ticket.current += 1;
      controller.current?.abort();
    };
  }, [cacheKey, enabled, run]);

  useEffect(() => {
    if (!cacheKey) return;
    const notify = (next: unknown, at: Date) => {
      setData(next as T);
      setSyncedAt(at);
      setFailure(null);
    };
    const set = watchers.get(cacheKey) ?? new Set<(data: unknown, at: Date) => void>();
    set.add(notify);
    watchers.set(cacheKey, set);
    return () => {
      set.delete(notify);
      if (set.size === 0) watchers.delete(cacheKey);
    };
  }, [cacheKey]);

  const reload = useCallback(() => run("refresh"), [run]);

  return { data, loading, refreshing, failure, status, syncedAt, reload };
}
