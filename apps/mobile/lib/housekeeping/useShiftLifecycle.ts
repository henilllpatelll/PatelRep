import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  endShift,
  getShiftState,
  newShiftId,
  setShiftBreak,
  startShift,
  type ShiftSession,
} from "@/lib/api/shifts";
import {
  resolveShiftLifecycle,
  type ShiftLifecycle,
  type ShiftPendingOp,
} from "@/lib/housekeeping/shiftLifecycle";

export type ShiftActionResult =
  | { ok: true }
  | { ok: false; reason: "offline" | "busy" | "not_allowed" | "failed"; message?: string };

interface Options {
  /** Only housekeepers have a shift; other roles never touch /shifts. */
  enabled: boolean;
  /** `${tenantId}:${userId}`; shift state never carries across people or hotels. */
  scope: string | null;
  /** The hotel's current shift date (YYYY-MM-DD). */
  shiftDate: string;
  timeZone: string | null;
  isOnline: boolean;
}

interface ServerState {
  current: ShiftSession | null;
  lastEnded: ShiftSession | null;
  serverConfirmed: boolean;
  lastFetchFailed: boolean;
}

const EMPTY: ServerState = { current: null, lastEnded: null, serverConfirmed: false, lastFetchFailed: false };

export interface ShiftController {
  lifecycle: ShiftLifecycle;
  /** Read the server's view. Never starts a shift. Skipped while an action is in flight. */
  refresh: () => Promise<void>;
  /** Explicit user action only. */
  start: () => Promise<ShiftActionResult>;
  /** Resolves only after the server confirms; concurrent calls share one request. */
  end: () => Promise<ShiftActionResult>;
  startBreak: () => Promise<ShiftActionResult>;
  endBreak: () => Promise<ShiftActionResult>;
  lastError: string | null;
  clearError: () => void;
}

/**
 * Owns the shift lifecycle for the Home screen. Mounting, focus and foreground
 * only ever READ (`refresh`); every write is an explicit call. A response that
 * arrives after the person/hotel changed, or after a newer action began, is
 * dropped so it can never overwrite fresher state.
 */
export function useShiftLifecycle({ enabled, scope, shiftDate, timeZone, isOnline }: Options): ShiftController {
  const [server, setServer] = useState<ServerState>(EMPTY);
  const [pendingOp, setPendingOp] = useState<ShiftPendingOp>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const seq = useRef(0);
  const scopeRef = useRef<string | null>(scope);
  const opRef = useRef<ShiftPendingOp>(null);
  const endRun = useRef<Promise<ShiftActionResult> | null>(null);
  // One tap = one idempotency key, reused if the request has to be retried.
  const startIntent = useRef<{ id: string; startedAt: Date } | null>(null);

  const lifecycle = useMemo(
    () =>
      resolveShiftLifecycle({
        ...server,
        pendingOp,
        shiftDate,
        timeZone,
        isOnline,
      }),
    [server, pendingOp, shiftDate, timeZone, isOnline],
  );
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  // A different person or hotel starts from nothing.
  useEffect(() => {
    scopeRef.current = scope;
    seq.current += 1;
    opRef.current = null;
    endRun.current = null;
    startIntent.current = null;
    setServer(EMPTY);
    setPendingOp(null);
    setLastError(null);
  }, [scope]);

  const begin = useCallback((op: Exclude<ShiftPendingOp, null>) => {
    opRef.current = op;
    seq.current += 1; // any read already in flight predates this action
    setPendingOp(op);
    setLastError(null);
  }, []);
  const finish = useCallback(() => {
    opRef.current = null;
    setPendingOp(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !isOnline || !scope || opRef.current) return;
    const mySeq = (seq.current += 1);
    try {
      const next = await getShiftState();
      if (mySeq !== seq.current || scopeRef.current !== scope) return;
      setServer({ ...next, serverConfirmed: true, lastFetchFailed: false });
    } catch {
      if (mySeq !== seq.current || scopeRef.current !== scope) return;
      // Keep the last known state; a failed read proves nothing either way.
      setServer((prev) => ({ ...prev, lastFetchFailed: true }));
    }
  }, [enabled, isOnline, scope]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [enabled, refresh]);

  const apply = useCallback(
    (row: ShiftSession | null, expect: (r: ShiftSession) => boolean): boolean => {
      if (!row || !expect(row)) return false;
      setServer((prev) =>
        row.status === "ended"
          ? { current: null, lastEnded: row, serverConfirmed: true, lastFetchFailed: false }
          : { ...prev, current: row, serverConfirmed: true, lastFetchFailed: false },
      );
      return true;
    },
    [],
  );

  const guard = useCallback(
    (allowed: (l: ShiftLifecycle) => boolean): ShiftActionResult | null => {
      if (opRef.current) return { ok: false, reason: "busy" };
      if (!isOnline) return { ok: false, reason: "offline" };
      if (!allowed(lifecycleRef.current)) return { ok: false, reason: "not_allowed" };
      return null;
    },
    [isOnline],
  );

  const start = useCallback(async (): Promise<ShiftActionResult> => {
    const blocked = guard((l) => l.canStart);
    if (blocked) return blocked;
    const intent = (startIntent.current ??= { id: newShiftId(), startedAt: new Date() });
    const myScope = scopeRef.current;
    begin("start");
    try {
      const row = await startShift(intent);
      if (scopeRef.current !== myScope) return { ok: false, reason: "failed" };
      // The server hands back an already-ended row when this key was used before.
      if (!apply(row, (r) => r.status !== "ended")) {
        startIntent.current = null;
        setLastError("start_not_applied");
        return { ok: false, reason: "failed", message: "start_not_applied" };
      }
      startIntent.current = null;
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      return { ok: false, reason: "failed", message };
    } finally {
      finish();
    }
  }, [apply, begin, finish, guard]);

  const end = useCallback((): Promise<ShiftActionResult> => {
    // A second tap while the first is in flight rides the same request.
    if (endRun.current) return endRun.current;
    const blocked = guard((l) => l.canEnd);
    if (blocked) return Promise.resolve(blocked);
    const myScope = scopeRef.current;
    begin("end");
    const run = (async (): Promise<ShiftActionResult> => {
      try {
        const row = await endShift(new Date());
        if (scopeRef.current !== myScope) return { ok: false, reason: "failed" };
        if (apply(row, (r) => r.status === "ended")) return { ok: true };
        // Null: the server has no open shift for this person (already ended elsewhere).
        // Re-read so the screen shows what actually happened.
        const state = await getShiftState();
        if (scopeRef.current !== myScope) return { ok: false, reason: "failed" };
        setServer({ ...state, serverConfirmed: true, lastFetchFailed: false });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        return { ok: false, reason: "failed", message };
      } finally {
        endRun.current = null;
        finish();
      }
    })();
    endRun.current = run;
    return run;
  }, [apply, begin, finish, guard]);

  const toggleBreak = useCallback(
    async (action: "start" | "end"): Promise<ShiftActionResult> => {
      const blocked = guard((l) => (action === "start" ? l.canStartBreak : l.canEndBreak));
      if (blocked) return blocked;
      const myScope = scopeRef.current;
      begin("break");
      try {
        const row = await setShiftBreak(action);
        if (scopeRef.current !== myScope) return { ok: false, reason: "failed" };
        if (!apply(row, (r) => r.status !== "ended")) {
          // No open shift anymore (ended elsewhere): learn the truth rather than guess.
          const state = await getShiftState();
          if (scopeRef.current === myScope) setServer({ ...state, serverConfirmed: true, lastFetchFailed: false });
          return { ok: false, reason: "not_allowed" };
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        return { ok: false, reason: "failed", message };
      } finally {
        finish();
      }
    },
    [apply, begin, finish, guard],
  );

  const startBreak = useCallback(() => toggleBreak("start"), [toggleBreak]);
  const endBreak = useCallback(() => toggleBreak("end"), [toggleBreak]);
  const clearError = useCallback(() => setLastError(null), []);

  return { lifecycle, refresh, start, end, startBreak, endBreak, lastError, clearError };
}
