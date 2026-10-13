import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  claimTask,
  completeTask,
  fetchAvailable,
  fetchMyWork,
  fetchTask,
  reportBlocker,
  resumeTask,
  startTask,
  type BlockerReport,
  type Task,
} from "@/lib/api/tasks";
import { fetchDoneToday, type DoneToday } from "@/lib/tasks/workQueue";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useAppStore } from "@/stores/appStore";
import { readTaskCache, saveDoneToday, saveMyWork } from "@/lib/tasks/offline/taskCache";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";

/* ─── Server-authoritative queue state for the Housekeeper Tasks screen ───────
   * My Work and Available load independently: one failing or loading never resets the other.
   * A failed load is an error (never "no tasks"); a failed refresh keeps the last good data, flagged stale.
   * Overlapping refreshes share one request; a response older than a newer mutation/refresh is dropped.
   * Every mutation is locked per task id, only succeeds on a real server success, and is followed by a refresh.
   * Mutations need a connection, except completing an assigned task, which the screen can save to the
     task outbox (lib/tasks/offline) when the phone is offline.
   * My Work and Done Today are cached per signed-in person + hotel: they show instantly on start-up and
     offline, flagged `fromCache` / `stale` with the time they were last synced; the Available pool is never cached. */

export type ListStatus = "loading" | "ready" | "error";

export interface ListState {
  tasks: Task[];
  status: ListStatus;
  /** The last refresh failed; `tasks` is the previous good data. */
  stale: boolean;
  /** The server hit its scan cap: the list may be incomplete. */
  truncated: boolean;
  /** When this data was last confirmed by the server (cache or live); null = never. */
  syncedAt: string | null;
  /** Showing the saved copy; no live response has replaced it yet. */
  fromCache: boolean;
}

export type MutationCode = "offline" | "busy" | "conflict" | "failed";
export type MutationResult =
  | {
      ok: true;
      /** The authoritative task after the change. */
      task: Task | null;
      /** Completion only: false means the task is done but the optional note was NOT stored. */
      noteSaved: boolean | null;
    }
  | {
      ok: false;
      code: MutationCode;
      /** The task as the server now reports it (null = can no longer be read). Set after a refusal. */
      current?: Task | null;
      /** No answer came back, so the request may or may not have landed; state was re-read before reporting. */
      uncertain?: boolean;
      /** The server's machine-readable reason (e.g. blocker_already_active, task_blocked), when it gave one. */
      errorCode?: string;
    };

/** Focus / foreground refreshes closer together than this reuse what is on screen (pull-to-refresh never waits). */
export const REFRESH_COOLDOWN_MS = 15_000;

const INITIAL: ListState = { tasks: [], status: "loading", stale: false, truncated: false, syncedAt: null, fromCache: false };

function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

interface Options {
  isOnline: boolean;
  timeZone: string | null;
  /** Signed-in employee; lets a transition that landed with a lost reply be recognised as success. */
  userId?: string | null;
  /** `${hotel}:${employee}` key for the offline cache; null = signed out (nothing is cached or shown). */
  scope?: string | null;
}

export function useWorkQueue({ isOnline, timeZone, userId = null, scope = null }: Options) {
  const [mine, setMine] = useState<ListState>(INITIAL);
  const [available, setAvailable] = useState<ListState>(INITIAL);
  const [done, setDone] = useState<{ value: DoneToday | null; failed: boolean; syncedAt: string | null }>({ value: null, failed: false, syncedAt: null });
  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const seq = useRef({ mine: 0, available: 0, done: 0 });
  const inFlight = useRef<Record<"mine" | "available" | "done", { token: number; promise: Promise<void> } | null>>({
    mine: null,
    available: null,
    done: null,
  });
  const locks = useRef(new Set<string>());
  const zoneRef = useRef(timeZone);
  zoneRef.current = timeZone;
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  // When My Work last loaded for real. Focus / foreground refreshes within REFRESH_COOLDOWN_MS of it are skipped
  // so tab flicking, a permission dialog or a notification-shade pull cannot fire a request storm.
  const lastMineOk = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const guarded = useCallback(
    (name: "mine" | "available" | "done", run: (token: number) => Promise<void>): Promise<void> => {
      const existing = inFlight.current[name];
      // Share a request that is still current; one invalidated by a mutation must be replaced.
      if (existing && existing.token === seq.current[name]) return existing.promise;
      const token = ++seq.current[name];
      const promise = run(token).finally(() => {
        if (inFlight.current[name]?.token === token) inFlight.current[name] = null;
      });
      inFlight.current[name] = { token, promise };
      return promise;
    },
    [],
  );

  const loadMine = useCallback(
    () =>
      guarded("mine", async (token) => {
        try {
          const result = await fetchMyWork();
          if (!mounted.current || token !== seq.current.mine) return;
          const forScope = scopeRef.current;
          lastMineOk.current = Date.now();
          setMine({ tasks: result.tasks, status: "ready", stale: false, truncated: result.truncated, syncedAt: new Date().toISOString(), fromCache: false });
          if (forScope) void saveMyWork(forScope, result.tasks, result.truncated, zoneRef.current);
        } catch {
          if (!mounted.current || token !== seq.current.mine) return;
          setMine((prev) => (prev.status === "ready" ? { ...prev, stale: true } : { ...INITIAL, status: "error" }));
        }
      }),
    [guarded],
  );

  const loadAvailable = useCallback(
    () =>
      guarded("available", async (token) => {
        try {
          const result = await fetchAvailable();
          if (!mounted.current || token !== seq.current.available) return;
          setAvailable({ tasks: result.tasks, status: "ready", stale: false, truncated: result.truncated, syncedAt: new Date().toISOString(), fromCache: false });
        } catch {
          if (!mounted.current || token !== seq.current.available) return;
          setAvailable((prev) => (prev.status === "ready" ? { ...prev, stale: true } : { ...INITIAL, status: "error" }));
        }
      }),
    [guarded],
  );

  const loadDone = useCallback(
    () =>
      guarded("done", async (token) => {
        try {
          const value = await fetchDoneToday(zoneRef.current);
          if (!mounted.current || token !== seq.current.done) return;
          const forScope = scopeRef.current;
          setDone({ value, failed: false, syncedAt: new Date().toISOString() });
          const day = hotelDateKey(new Date(), zoneRef.current);
          if (forScope && day) void saveDoneToday(forScope, value, day);
        } catch {
          if (!mounted.current || token !== seq.current.done) return;
          // keep the last known count; flag that it could not be confirmed
          setDone((prev) => ({ value: prev.value, failed: true, syncedAt: prev.syncedAt }));
        }
      }),
    [guarded],
  );

  // A different person or hotel (or sign-out) never inherits the previous lists: reset, then show only
  // this scope's saved copy until the first live response replaces it.
  const lastScope = useRef<string | null | undefined>(undefined);
  const refreshAllRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (lastScope.current === scope) return;
    const switched = lastScope.current !== undefined;
    lastScope.current = scope;
    if (switched) {
      seq.current.mine += 1;
      seq.current.available += 1;
      seq.current.done += 1;
      inFlight.current = { mine: null, available: null, done: null };
      setMine(INITIAL);
      setAvailable(INITIAL);
      setDone({ value: null, failed: false, syncedAt: null });
      if (scope) void refreshAllRef.current();
    }
    if (!scope) return;
    let live = true;
    void readTaskCache(scope).then((cache) => {
      if (!live || scopeRef.current !== scope) return;
      if (cache.hotelTimezone && !useAppStore.getState().hotelTimezone) useAppStore.getState().setHotelTimezone(cache.hotelTimezone);
      if (cache.mine) {
        const saved = cache.mine;
        // A live response that already arrived is newer than the saved copy.
        setMine((prev) =>
          prev.status === "ready" && !prev.fromCache
            ? prev
            : { tasks: saved.tasks, status: "ready", stale: true, truncated: saved.truncated, syncedAt: saved.syncedAt, fromCache: true },
        );
      }
      const day = hotelDateKey(new Date(), zoneRef.current ?? cache.hotelTimezone);
      if (cache.doneToday && day && cache.doneToday.day === day) {
        const saved = cache.doneToday;
        setDone((prev) => (prev.value ? prev : { value: { count: saved.count, atLeast: saved.atLeast }, failed: true, syncedAt: saved.syncedAt }));
      }
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMine(), loadAvailable(), loadDone()]);
  }, [loadMine, loadAvailable, loadDone]);
  refreshAllRef.current = refreshAll;
  const refreshIfDue = useCallback(async () => {
    if (Date.now() - lastMineOk.current < REFRESH_COOLDOWN_MS) return;
    await refreshAll();
  }, [refreshAll]);

  // A saved change was confirmed (or refused) by the server: re-read the lists, which are the truth.
  const settledTick = useTaskOutbox((state) => state.settledTick);
  const seenTick = useRef(settledTick);
  useEffect(() => {
    if (settledTick === seenTick.current) return;
    seenTick.current = settledTick;
    void refreshAll();
  }, [settledTick, refreshAll]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [refreshAll]);

  // Refresh whenever the screen gains focus, and when the app returns to the foreground.
  useFocusEffect(
    useCallback(() => {
      void refreshIfDue();
    }, [refreshIfDue]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Saved completions first (cheap no-op when nothing is due), then re-read the lists.
      void useTaskOutbox.getState().flush();
      void refreshIfDue();
    });
    return () => sub.remove();
  }, [refreshIfDue]);

  // Coming back online: reconcile immediately rather than waiting for the next focus.
  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) void refreshAll();
    wasOnline.current = isOnline;
  }, [isOnline, refreshAll]);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const userRef = useRef(userId);
  userRef.current = userId;
  const isMineNow = (task: Task) => !!userRef.current && task.assigned_to === userRef.current;

  /**
   * Run one lifecycle request under a per-task lock.
   * - Success only ever comes from a real server response.
   * - A definitive refusal (403/404/409) re-reads the task so the caller can explain why.
   * - No HTTP status at all (timeout / dropped connection) is an uncertain outcome: the task is re-read
   *   first, and if `landed` says the change did happen it counts as success; otherwise the failure is
   *   reported as uncertain so the UI can invite a retry (every lifecycle verb is replay-safe server-side).
   * Every outcome ends with a list reconcile.
   */
  const mutate = useCallback(
    async (
      id: string,
      run: () => Promise<{ task: Task | null; noteSaved: boolean | null }>,
      landed: (task: Task) => boolean,
    ): Promise<MutationResult> => {
      if (!onlineRef.current) return { ok: false, code: "offline" };
      if (locks.current.has(id)) return { ok: false, code: "busy" };
      locks.current.add(id);
      setBusy(id, true);
      try {
        const outcome = await run();
        return { ok: true, task: outcome.task, noteSaved: outcome.noteSaved };
      } catch (error) {
        const status = httpStatus(error);
        let current: Task | null | undefined;
        try {
          current = await fetchTask(id);
        } catch (readError) {
          const readStatus = httpStatus(readError);
          current = readStatus === 404 || readStatus === 403 ? null : undefined;
        }
        if (status === null && current && landed(current)) {
          return { ok: true, task: current, noteSaved: null };
        }
        const rawCode = (error as { code?: unknown } | null)?.code;
        const errorCode = typeof rawCode === "string" ? rawCode : undefined;
        if (status === 403 || status === 404 || status === 409) return { ok: false, code: "conflict", current, errorCode };
        return { ok: false, code: "failed", current, uncertain: status === null, errorCode };
      } finally {
        locks.current.delete(id);
        if (mounted.current) setBusy(id, false);
        // Server truth wins: every outcome ends with a reconcile.
        void refreshAll();
      }
    },
    [refreshAll],
  );

  const upsertMine = (task: Task) =>
    setMine((prev) => ({
      ...prev,
      tasks: prev.tasks.some((t) => t.id === task.id)
        ? prev.tasks.map((t) => (t.id === task.id ? task : t))
        : [...prev.tasks, task],
    }));

  const start = useCallback(
    (id: string) =>
      mutate(
        id,
        async () => {
          const { task } = await startTask(id);
          seq.current.mine += 1; // drop any older list response still in flight
          upsertMine(task);
          return { task, noteSaved: null };
        },
        (task) => task.status === "in_progress" && isMineNow(task),
      ),
    [mutate],
  );

  const claim = useCallback(
    (id: string) =>
      mutate(
        id,
        async () => {
          const { task } = await claimTask(id);
          seq.current.mine += 1;
          seq.current.available += 1;
          setAvailable((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
          upsertMine(task);
          return { task, noteSaved: null };
        },
        (task) => task.status === "in_progress" && isMineNow(task),
      ),
    [mutate],
  );

  /** `note` is optional; the server stores it with the completion and says whether it did. */
  const complete = useCallback(
    (id: string, note?: string) =>
      mutate(
        id,
        async () => {
          const { task, noteSaved } = await completeTask(id, note);
          seq.current.mine += 1;
          setMine((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }));
          return { task, noteSaved: note && note.trim() ? noteSaved : null };
        },
        (task) => task.status === "completed",
      ),
    [mutate],
  );

  /**
   * "Unable to complete?": the server stores the report (reporter + server time) and the task stays
   * assigned and unfinished. `draft.clientRequestId` makes a retry safe: it can never report twice.
   */
  const reportProblem = useCallback(
    (id: string, draft: BlockerReport) =>
      mutate(
        id,
        async () => {
          const { task } = await reportBlocker(id, draft);
          seq.current.mine += 1;
          upsertMine(task);
          return { task, noteSaved: null };
        },
        (task) => !!task.blocker && task.blocker.reason === draft.reason && task.blocker.reported_by === userRef.current,
      ),
    [mutate],
  );

  /** Clear my own blocker; `blockerId` pins the report I was looking at so a stale screen can not overwrite a newer one. */
  const resume = useCallback(
    (id: string, blockerId: string) =>
      mutate(
        id,
        async () => {
          const { task } = await resumeTask(id, blockerId);
          seq.current.mine += 1;
          upsertMine(task);
          return { task, noteSaved: null };
        },
        (task) => task.blocker === null && isMineNow(task),
      ),
    [mutate],
  );

  return {
    mine,
    available,
    done,
    refreshing,
    busyIds,
    refreshAll,
    pullToRefresh,
    reloadMine: loadMine,
    reloadAvailable: loadAvailable,
    start,
    claim,
    complete,
    reportProblem,
    resume,
  };
}
