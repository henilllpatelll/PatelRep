import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWorkOrderSummary, listActiveWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules, type PmScheduleRow } from "@/lib/api/assets";
import { sortQueue, type WorkOrder } from "@/lib/engineering/workOrders";
import type { WorkSummary } from "@/lib/engineering/workSummary";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { createRefreshGate, type RefreshReason } from "@/lib/engineering/refreshGate";
import { loadQueueSnapshot, saveQueueSnapshot } from "@/lib/engineering/workOrderCache";

/**
 * The saved-queue key for the technician Home (the Work screen keeps its own per-view snapshots). It carries the role,
 * because what the server lets a role read differs (an engineer's list is own + unclaimed, a manager's is hotel-wide), so a
 * copy saved under one role is never shown under another.
 */
export const homeSnapshotKey = (role: string | null | undefined): string => `home:${role ?? "none"}`;

export interface EngineeringHomeData {
  orders: WorkOrder[];
  pmRows: PmScheduleRow[];
  /** Latest work-order load failed (the data above is then the last good copy, if any). */
  queueFailure: LoadFailure | null;
  pmFailure: LoadFailure | null;
  /** True once a work-order load has succeeded for this hotel + person (or a saved copy was shown after going offline). */
  hasQueue: boolean;
  hasPm: boolean;
  /** Exact server count of the caller's own active work (My Jobs); null while unknown or when that read failed. */
  summary: WorkSummary | null;
  /** More than one page of active work exists beyond what was read (or the queue is a saved, capped copy); counts are lower bounds. */
  truncated: boolean;
  /** The queue on screen is the copy saved on this phone, not a fresh server read. */
  fromSaved: boolean;
  loading: boolean;
  refreshing: boolean;
  /** When the work-order queue was last read successfully (or, for a saved copy, when it was saved). */
  syncedAt: Date | null;
  /** Ask for a re-read. Every trigger goes through one gate: a read already running is joined, never doubled. */
  request: (reason: RefreshReason) => Promise<void>;
  /** Silent re-read (Retry). */
  reload: () => Promise<void>;
  /** Pull-to-refresh: re-read and show the spinner. */
  refresh: () => Promise<void>;
}

type State = Omit<EngineeringHomeData, "request" | "reload" | "refresh" | "loading" | "refreshing">;

const EMPTY: State = {
  orders: [],
  pmRows: [],
  queueFailure: null,
  pmFailure: null,
  hasQueue: false,
  hasPm: false,
  summary: null,
  truncated: false,
  fromSaved: false,
  syncedAt: null,
};

/**
 * Loads the active queue (open, escalated, in progress, on hold — never completed history; one request per page of 100),
 * the exact own-work counts and the PM schedules for the signed-in person at their hotel. The sections fail independently: each keeps its last good data and reports its own
 * failure, so an error is never rendered as "nothing to do". A new hotel or person starts from a clean slate, and an answer
 * that arrives for a previous scope or an older request is dropped.
 *
 * Offline with nothing loaded yet, the last queue saved on this phone (this person + hotel only, 72 h at most) is shown
 * as a lower bound and labelled stale; it is never shown instead of a live answer.
 */
export function useEngineeringHome(scope: string | null, role?: string | null): EngineeringHomeData {
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const roleRef = useRef(role);
  roleRef.current = role;
  const hasQueueRef = useRef(false);
  hasQueueRef.current = state.hasQueue && !state.fromSaved;

  const load = useCallback(async () => {
    const ticket = generation.current;
    const requestScope = scopeRef.current;
    const requestRole = roleRef.current;
    const stale = () => ticket !== generation.current || requestScope !== scopeRef.current;
    const [queueRes, pmRes, summaryRes] = await Promise.all([
      Promise.allSettled([listActiveWorkOrders()]),
      Promise.allSettled([listPmSchedules()]),
      Promise.allSettled([getWorkOrderSummary()]),
    ]);
    if (stale()) return;

    const rejected = queueRes.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const pm = pmRes[0];
    const summary = summaryRes[0];

    // Offline before anything was ever read: fall back to the saved copy (read once, then re-checked against the scope).
    let saved: Awaited<ReturnType<typeof loadQueueSnapshot>> = null;
    if (rejected && !hasQueueRef.current && classifyLoadFailure(rejected.reason) === "offline") {
      try {
        saved = await loadQueueSnapshot(homeSnapshotKey(roleRef.current));
      } catch {
        saved = null;
      }
      if (stale()) return;
    }

    const results = rejected ? null : queueRes.map((r) => (r as PromiseFulfilledResult<{ orders: WorkOrder[]; truncated: boolean }>).value);
    const fresh = results ? results.flatMap((r) => r.orders) : null;
    setState((prev) => {
      const next = { ...prev };
      if (rejected) {
        next.queueFailure = classifyLoadFailure(rejected.reason);
        if (saved && !prev.hasQueue) {
          const at = new Date(saved.savedAt);
          next.orders = saved.orders;
          next.truncated = true; // a capped copy can never prove completeness
          next.hasQueue = true;
          next.fromSaved = true;
          next.syncedAt = Number.isNaN(at.getTime()) ? null : at;
        }
      } else {
        next.orders = fresh ?? [];
        next.truncated = results?.some((r) => r.truncated) ?? false;
        next.queueFailure = null;
        next.hasQueue = true;
        next.fromSaved = false;
        next.syncedAt = new Date();
      }
      // The exact count describes the moment it was read. When this read of it failed it is dropped rather than shown
      // beside a newer queue; My Jobs then falls back to the queue and is marked as a lower bound if that was cut off.
      next.summary = summary.status === "fulfilled" ? (summary.value ?? null) : null;
      if (pm.status === "rejected") {
        next.pmFailure = classifyLoadFailure(pm.reason);
      } else {
        next.pmRows = pm.value;
        next.pmFailure = null;
        next.hasPm = true;
      }
      return next;
    });
    // Saved after the state update so the copy is the exact set the screen just accepted (most urgent first, capped).
    if (fresh) void saveQueueSnapshot(homeSnapshotKey(requestRole), sortQueue(fresh));
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;
  const gate = useRef(createRefreshGate(() => loadRef.current()));

  // A different hotel or person must never see the previous one's queue, even for a moment, and must never join a read
  // that was started for the previous one (so it gets its own gate).
  useEffect(() => {
    generation.current += 1;
    gate.current = createRefreshGate(() => loadRef.current());
    setState(EMPTY);
    setRefreshing(false);
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = gate.current;
    void mine.request("manual").finally(() => {
      if (scopeRef.current === scope && gate.current === mine) setLoading(false);
    });
  }, [scope]);

  const request = useCallback((reason: RefreshReason) => gate.current.request(reason), []);
  const reload = useCallback(() => gate.current.request("manual"), []);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await gate.current.request("manual");
    } finally {
      setRefreshing(false);
    }
  }, []);

  return useMemo(() => ({ ...state, loading, refreshing, request, reload, refresh }), [state, loading, refreshing, request, reload, refresh]);
}
