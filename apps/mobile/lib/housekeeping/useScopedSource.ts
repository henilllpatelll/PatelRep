import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  fetchedAtOf,
  isVerified,
  loadingSource,
  offlineSource,
  settleSource,
  type SourceState,
} from "@/lib/housekeeping/supervisorSources";

/* One independent, scoped data source — the same discipline `useRoomBoard` applies to late checkouts, made
   reusable for the Assignments-only sources (workload settings, today's schedule).

   - Scoped: an answer belongs to `scopeKey` (`tenant:user`) and `key` (e.g. the hotel date). Switching either
     throws the held answer away (the screen reads "loading" until the new one lands), and a response that
     arrives after the scope moved on — or after a newer request started — is DISCARDED.
   - Honest failure: a failed refresh keeps the last verified answer, relabelled stale; with none it is
     `failed`. It is never an empty value.
   - It does not subscribe to anything. Refresh timing (pull, Realtime, hotel-day rollover) belongs to the
     caller; this only reloads on scope change, on regaining connectivity, and on returning to the foreground
     when its answer is no longer fresh. */

export interface UseScopedSourceOptions<T> {
  /** `tenant:user`; null = nobody is signed in, so nothing is loaded. */
  scopeKey: string | null;
  active: boolean;
  isOnline: boolean;
  /** Part of the scope that is not the user (the hotel date). A different key is a different source. */
  key?: string;
  load: () => Promise<T>;
  /** Treat an answer as a verified "nothing" (e.g. an empty schedule). Default: never empty. */
  isEmpty?: (value: T) => boolean;
  /** An answer older than this is reloaded when the app returns to the foreground. */
  staleAfterMs: number;
}

export interface ScopedSource<T> {
  state: SourceState<T>;
  reload: () => Promise<void>;
}

interface Held<T> {
  scope: string | null;
  state: SourceState<T>;
}

export function useScopedSource<T>({ scopeKey, active, isOnline, key = "", load, isEmpty, staleAfterMs }: UseScopedSourceOptions<T>): ScopedSource<T> {
  const scopeId = scopeKey ? `${scopeKey}|${key}` : null;
  // Latest callbacks are read at call time so an inline function from a caller can never retrigger the load.
  const loadRef = useRef(load);
  loadRef.current = load;
  const emptyRef = useRef(isEmpty);
  emptyRef.current = isEmpty;

  const [held, setHeld] = useState<Held<T>>({ scope: scopeId, state: loadingSource<T>() });
  const heldRef = useRef(held);
  heldRef.current = held;
  const seq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, []);

  // A different hotel, person or key: nothing in flight for the old one may land.
  useEffect(() => {
    seq.current += 1;
  }, [scopeId]);

  const reload = useCallback(async () => {
    if (!active || !scopeId) return;
    const mine = (seq.current += 1);
    const previousOf = (current: Held<T>): SourceState<T> => (current.scope === scopeId ? current.state : loadingSource<T>());
    if (!isOnline) {
      setHeld((current) => {
        const next = offlineSource(previousOf(current));
        return current.scope === scopeId && current.state === next ? current : { scope: scopeId, state: next };
      });
      return;
    }
    const [result] = await Promise.allSettled([loadRef.current()]);
    if (mine !== seq.current || !mounted.current) return;
    setHeld((current) => ({ scope: scopeId, state: settleSource(result, previousOf(current), Date.now(), emptyRef.current) }));
  }, [active, scopeId, isOnline]);

  // Loads when first used, when the scope or key changes, and again whenever connectivity returns.
  useEffect(() => {
    void reload();
  }, [reload]);

  // Back from the background: reload only when what is held is no longer fresh.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState !== "active") return;
      const current = heldRef.current;
      const at = current.scope === scopeId ? fetchedAtOf(current.state) : null;
      const fresh = current.scope === scopeId && isVerified(current.state) && at !== null && Date.now() - at <= staleAfterMs;
      if (!fresh) void reload();
    });
    return () => subscription.remove();
  }, [reload, scopeId, staleAfterMs]);

  return { state: held.scope === scopeId ? held.state : loadingSource<T>(), reload };
}
