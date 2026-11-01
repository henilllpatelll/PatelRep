import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  getWorkOrder,
  getWorkOrderAudit,
  getWorkOrderEvents,
  getWorkOrderLabor,
  getWorkOrderParts,
  listAssetRepairs,
} from "@/lib/api/workOrders";
import { getPendingSyncQueue } from "@/lib/offline/db";
import { loadWorkOrderCopy, saveWorkOrderCopy } from "@/lib/engineering/workOrderCache";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import {
  estimateClockSkewMs,
  type AuditEvent,
  type ConsumedPartRow,
  type LaborSession,
  type TimingEvent,
} from "@/lib/engineering/repairWorkspace";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export type DetailSection = "labor" | "history" | "parts" | "related";

interface Secondary {
  labor: LaborSession[];
  timing: TimingEvent[];
  audit: AuditEvent[];
  parts: ConsumedPartRow[];
  related: WorkOrder[];
}

export interface QueuedWorkOrderActions {
  claim: boolean;
  complete: boolean;
}

export interface WorkOrderDetailHandle {
  wo: WorkOrder | null;
  loading: boolean;
  /** The order itself failed to load and there is nothing to show. */
  failure: LoadFailure | null;
  secondary: Secondary;
  /** Sections whose last read failed — shown as "couldn't load", never as an empty list. */
  sectionFailed: Partial<Record<DetailSection, boolean>>;
  queued: QueuedWorkOrderActions;
  /**
   * The order on screen is a saved copy from an earlier live read (ISO time), shown because this read failed with no
   * connection. Null whenever the order came from the server just now.
   */
  cachedAt: string | null;
  /** Device clock minus server clock, so a running timer is not off by a wrong phone clock. */
  skewMs: number;
  /** Replace the order with a copy the server just returned (e.g. after a diagnosis save). */
  setOrder: (next: WorkOrder) => void;
  /**
   * Re-read the order and the named sections only (adding a note does not re-read labor, and so on).
   * `startedLabor` says this refresh follows a timer start the app just made, which is the only moment a session's
   * `started_at` equals "now on the server" and so can reveal a wrong phone clock.
   */
  refresh: (sections?: DetailSection[], opts?: { order?: boolean; startedLabor?: boolean }) => Promise<void>;
}

const EMPTY: Secondary = { labor: [], timing: [], audit: [], parts: [], related: [] };

/**
 * Loads one work order and its secondary records. The order is the only thing that can fail the screen; labor,
 * history, parts and related repairs load beside it and fail on their own. Every request carries a token so a slow
 * answer for an earlier call never overwrites a newer one, and everything is dropped on unmount or when the id changes.
 */
export function useWorkOrderDetail(woId: string, userId: string | null | undefined): WorkOrderDetailHandle {
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [secondary, setSecondary] = useState<Secondary>(EMPTY);
  const [sectionFailed, setSectionFailed] = useState<Partial<Record<DetailSection, boolean>>>({});
  const [queued, setQueued] = useState<QueuedWorkOrderActions>({ claim: false, complete: false });
  const [skewMs, setSkewMs] = useState(0);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const woRef = useRef<WorkOrder | null>(null);
  woRef.current = wo;

  const readQueued = useCallback(async () => {
    try {
      const rows = (await getPendingSyncQueue()) as { entity_type: string; entity_id?: string | null; action: string }[];
      const mine = rows.filter((r) => r.entity_type === "work_order" && r.entity_id === woId);
      setQueued({ claim: mine.some((r) => r.action === "claim"), complete: mine.some((r) => r.action === "complete") });
    } catch {
      // The queue is local storage; if it cannot be read the screen simply shows no pending badge.
    }
  }, [woId]);

  const refresh = useCallback(
    async (sections: DetailSection[] = ["labor", "history", "parts", "related"], opts: { order?: boolean; startedLabor?: boolean } = {}) => {
      const mine = ++token.current;
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      const live = () => token.current === mine && !ctl.signal.aborted;

      const wantOrder = opts.order !== false;
      let order = woRef.current;
      if (wantOrder) {
        try {
          const fresh = await getWorkOrder(woId);
          if (!live()) return;
          order = fresh;
          setWo(fresh);
          setCachedAt(null);
          setFailure(null);
          void saveWorkOrderCopy(fresh);
        } catch (err) {
          if (!live()) return;
          // Keep what is on screen on a failed refresh; only a first load with nothing to show becomes an error.
          if (woRef.current == null) {
            const kind = classifyLoadFailure(err);
            // No connection: open the saved copy (labelled as such). A refusal or a server error is never hidden behind it.
            const saved = kind === "offline" ? await loadWorkOrderCopy(woId) : null;
            if (!live()) return;
            if (saved) {
              setWo(saved.order);
              setCachedAt(saved.savedAt);
              setFailure(null);
            } else setFailure(kind);
          }
          setLoading(false);
          return;
        }
      }
      setLoading(false);
      void readQueued();
      if (!order) return;

      const jobs: Promise<void>[] = [];
      const run = <T,>(section: DetailSection, fetcher: () => Promise<T>, apply: (value: T) => void) =>
        jobs.push(
          fetcher().then(
            (value) => {
              if (!live()) return;
              apply(value);
              setSectionFailed((prev) => (prev[section] ? { ...prev, [section]: false } : prev));
            },
            () => {
              if (!live()) return;
              setSectionFailed((prev) => ({ ...prev, [section]: true }));
            }
          )
        );

      if (sections.includes("labor")) {
        run("labor", () => getWorkOrderLabor(woId, ctl.signal), (labor) => {
          setSecondary((prev) => ({ ...prev, labor }));
          // A restored session proves nothing about the clock (it may simply be old), so skew is only read right after our own start.
          const mineRunning = labor.find((s) => s.ended_at == null && s.staff_user_id === userId);
          if (opts.startedLabor && mineRunning) setSkewMs(estimateClockSkewMs(mineRunning.started_at, Date.now()));
        });
      }
      if (sections.includes("history")) {
        run(
          "history",
          () => Promise.all([getWorkOrderEvents(woId, ctl.signal), getWorkOrderAudit(woId, ctl.signal)]),
          ([timing, audit]) => setSecondary((prev) => ({ ...prev, timing, audit }))
        );
      }
      if (sections.includes("parts") && (order.status === "completed" || order.status === "in_progress" || order.status === "on_hold")) {
        run("parts", () => getWorkOrderParts(woId, ctl.signal), (parts) => setSecondary((prev) => ({ ...prev, parts })));
      }
      if (sections.includes("related") && order.asset_id) {
        run(
          "related",
          () => listAssetRepairs(order!.asset_id as string, ctl.signal),
          (rows) => setSecondary((prev) => ({ ...prev, related: rows.filter((r) => r.id !== woId) }))
        );
      }
      await Promise.all(jobs);
    },
    [woId, userId, readQueued]
  );

  useEffect(() => {
    token.current += 1;
    setWo(null);
    setCachedAt(null);
    setSecondary(EMPTY);
    setFailure(null);
    setLoading(true);
    void refresh();
    return () => {
      token.current += 1;
      controller.current?.abort();
    };
  }, [woId, refresh]);

  // Coming back to the app re-reads labor: the server, not the phone's memory of a timer, says what is running.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && woRef.current) void refresh(["labor"], { order: false });
    });
    return () => sub.remove();
  }, [refresh]);

  const setOrder = useCallback((next: WorkOrder) => setWo(next), []);

  return { wo, loading, failure, secondary, sectionFailed, queued, cachedAt, skewMs, setOrder, refresh };
}

/** One-second tick for a running timer; stopped when nothing is running or the app is in the background. */
export function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    let id: ReturnType<typeof setInterval> | null = setInterval(() => setNow(Date.now()), 1000);
    const stop = () => {
      if (id != null) clearInterval(id);
      id = null;
    };
    const sub = AppState.addEventListener("change", (state) => {
      stop();
      if (state === "active") {
        setNow(Date.now());
        id = setInterval(() => setNow(Date.now()), 1000);
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [active]);
  return now;
}
