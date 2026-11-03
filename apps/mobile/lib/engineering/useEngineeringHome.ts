import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkOrderSummary, listActiveWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules, type PmScheduleRow } from "@/lib/api/assets";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { WorkSummary } from "@/lib/engineering/workSummary";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";

export interface EngineeringHomeData {
  orders: WorkOrder[];
  pmRows: PmScheduleRow[];
  /** Latest work-order load failed (the data above is then the last good copy, if any). */
  queueFailure: LoadFailure | null;
  pmFailure: LoadFailure | null;
  /** True once a work-order load has succeeded for this hotel + person. */
  hasQueue: boolean;
  hasPm: boolean;
  /** Exact server count of the caller's own active work (My Jobs); null while unknown or when that read failed. */
  summary: WorkSummary | null;
  /** More than one page of active work exists beyond what was read; counts are lower bounds. */
  truncated: boolean;
  loading: boolean;
  refreshing: boolean;
  /** When the work-order queue was last read successfully. */
  syncedAt: Date | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Loads the active queue (open, escalated, in progress, on hold — never completed history; one request per page of 100),
 * the exact own-work counts and the PM schedules for the signed-in person at their hotel. The sections fail independently: each keeps its last good data and reports its own
 * failure, so an error is never rendered as "nothing to do". A new hotel or person starts from a clean slate, and an answer
 * that arrives for a previous scope or an older request is dropped.
 */
export function useEngineeringHome(scope: string | null): EngineeringHomeData {
  const [state, setState] = useState<Omit<EngineeringHomeData, "reload" | "refresh" | "loading" | "refreshing">>({
    orders: [],
    pmRows: [],
    queueFailure: null,
    pmFailure: null,
    hasQueue: false,
    hasPm: false,
    summary: null,
    truncated: false,
    syncedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const requestScope = scopeRef.current;
    const [queueRes, pmRes, summaryRes] = await Promise.all([
      Promise.allSettled([listActiveWorkOrders()]),
      Promise.allSettled([listPmSchedules()]),
      Promise.allSettled([getWorkOrderSummary()]),
    ]);
    if (ticket !== generation.current || requestScope !== scopeRef.current) return;

    const rejected = queueRes.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const pm = pmRes[0];
    const summary = summaryRes[0];
    setState((prev) => {
      const next = { ...prev };
      if (rejected) {
        next.queueFailure = classifyLoadFailure(rejected.reason);
      } else {
        const results = queueRes.map((r) => (r as PromiseFulfilledResult<{ orders: WorkOrder[]; truncated: boolean }>).value);
        next.orders = results.flatMap((r) => r.orders);
        next.truncated = results.some((r) => r.truncated);
        next.queueFailure = null;
        next.hasQueue = true;
        next.syncedAt = new Date();
      }
      // The exact count is a bonus: when it is missing, My Jobs falls back to the queue and is marked as a lower bound.
      next.summary = summary.status === "fulfilled" ? (summary.value ?? prev.summary) : prev.summary;
      if (pm.status === "rejected") {
        next.pmFailure = classifyLoadFailure(pm.reason);
      } else {
        next.pmRows = pm.value;
        next.pmFailure = null;
        next.hasPm = true;
      }
      return next;
    });
  }, []);

  // A different hotel or person must never see the previous one's queue, even for a moment.
  useEffect(() => {
    generation.current += 1;
    setState({
      orders: [],
      pmRows: [],
      queueFailure: null,
      pmFailure: null,
      hasQueue: false,
      hasPm: false,
      summary: null,
      truncated: false,
      syncedAt: null,
    });
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load().finally(() => {
      if (scopeRef.current === scope) setLoading(false);
    });
  }, [scope, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { ...state, loading, refreshing, reload: load, refresh };
}
