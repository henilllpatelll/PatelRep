import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkOrderChecklist, setWorkOrderChecklistItem } from "@/lib/api/workOrders";
import { classifyLoadFailure } from "@/lib/engineering/loadState";
import { applyItemUpdate, type ChecklistLoad, type ChecklistSnapshot } from "@/lib/engineering/workOrderChecklist";

export type ChecklistItemError = "closed" | "forbidden" | "failed";

export interface WorkOrderChecklistHandle {
  load: ChecklistLoad;
  /** Steps with a request in flight. They show as saving and ignore further taps; nothing is changed until the server answers. */
  pending: ReadonlySet<string>;
  /** Why the last change to a step was refused. Cleared by the next attempt or a refresh. */
  itemErrors: Readonly<Record<string, ChecklistItemError>>;
  /** True when a refresh failed but an earlier confirmed read is still on screen. */
  stale: boolean;
  refresh: () => Promise<void>;
  /** Resolves true only when the server confirmed the change. A second tap on a step already saving resolves false. */
  setDone: (itemId: string, isDone: boolean) => Promise<boolean>;
}

/** The error the server gave for a refused step change, as one of the three things the person can be told. */
function itemErrorKind(error: unknown): ChecklistItemError {
  const e = error as { status?: number; code?: string } | null;
  if (e?.status === 409 && e.code === "work_order_closed") return "closed";
  if (e?.status === 403) return "forbidden";
  return "failed";
}

/**
 * Loads one order's checklist and applies step changes.
 *
 * Changes are confirmed, not optimistic: a tap marks the step as saving, and the step only changes when PATCH answers.
 * Answers can arrive out of order, so (1) each step has at most one request in flight, and (2) a read that began before
 * a change was confirmed is dropped when it lands, because the change's answer is newer than it is.
 */
export function useWorkOrderChecklist(woId: string): WorkOrderChecklistHandle {
  const [load, setLoad] = useState<ChecklistLoad>({ phase: "loading" });
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [itemErrors, setItemErrors] = useState<Record<string, ChecklistItemError>>({});

  const pendingRef = useRef(new Set<string>());
  const snapshotRef = useRef<ChecklistSnapshot | null>(null);
  const readToken = useRef(0);
  const changeEpoch = useRef(0);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const commit = useCallback((snapshot: ChecklistSnapshot) => {
    snapshotRef.current = snapshot;
    setLoad({ phase: "ready", snapshot });
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++readToken.current;
    const epoch = changeEpoch.current;
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    try {
      const snapshot = await getWorkOrderChecklist(woId, ctl.signal);
      if (!alive.current || mine !== readToken.current || ctl.signal.aborted) return;
      // A step was confirmed while this read was in flight: its answer is newer, so keep what is on screen.
      if (epoch !== changeEpoch.current) return;
      setStale(false);
      commit(snapshot);
    } catch (err) {
      if (!alive.current || mine !== readToken.current || ctl.signal.aborted) return;
      // Keep the last confirmed read on screen; only a first load with nothing to show becomes an error.
      if (snapshotRef.current) setStale(true);
      else setLoad({ phase: "error", failure: classifyLoadFailure(err) });
    }
  }, [woId, commit]);

  useEffect(() => {
    alive.current = true;
    snapshotRef.current = null;
    pendingRef.current = new Set();
    changeEpoch.current = 0;
    setPending(new Set());
    setItemErrors({});
    setStale(false);
    setLoad({ phase: "loading" });
    void refresh();
    return () => {
      alive.current = false;
      readToken.current += 1;
      controller.current?.abort();
    };
  }, [woId, refresh]);

  const setDone = useCallback(
    async (itemId: string, isDone: boolean): Promise<boolean> => {
      if (pendingRef.current.has(itemId)) return false;
      pendingRef.current.add(itemId);
      setPending(new Set(pendingRef.current));
      setItemErrors(({ [itemId]: _cleared, ...rest }) => rest);
      try {
        const { item, summary } = await setWorkOrderChecklistItem(woId, itemId, isDone);
        if (!alive.current) return true;
        changeEpoch.current += 1;
        const current = snapshotRef.current;
        if (current) commit(applyItemUpdate(current, item, summary));
        return true;
      } catch (err) {
        if (!alive.current) return false;
        const kind = itemErrorKind(err);
        setItemErrors((prev) => ({ ...prev, [itemId]: kind }));
        // The order closed or the step moved under us: re-read so the screen shows what is true.
        if (kind === "closed" || kind === "failed") void refresh();
        return false;
      } finally {
        pendingRef.current.delete(itemId);
        if (alive.current) setPending(new Set(pendingRef.current));
      }
    },
    [woId, commit, refresh]
  );

  return { load, pending, itemErrors, stale, refresh, setDone };
}
