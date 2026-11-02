import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncActivity } from "@/lib/offline/sync";
import { useAppStore } from "@/stores/appStore";
import { listQueuedCompletionsStrict, type QueuedPmRow } from "./pmCompletionQueue";
import { listPmDraftSummaries, type PmDraftSummary } from "./pmDraftStore";
import { discardQueued, retryQueued, submitAnyway, flushPmCompletions, usePmSyncActivity } from "./pmSyncRunner";

/**
 * The signed-in person's saved PM inspections (frozen, waiting for the server) and unfinished drafts, read from the real
 * stores. `loaded` stays false until the queue was read successfully, so a failed read is never shown as "nothing waiting".
 * Re-reads when the connection, a sync run or who is signed in changes; nothing polls.
 */
export function usePmSyncItems() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const isOnline = useAppStore((s) => s.isOnline);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const syncing = useSyncActivity((s) => s.active);
  const active = usePmSyncActivity((s) => s.active);
  const [rows, setRows] = useState<QueuedPmRow[]>([]);
  const [drafts, setDrafts] = useState<PmDraftSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const [queue, saved] = await Promise.all([listQueuedCompletionsStrict(), listPmDraftSummaries()]);
      if (mine !== latest.current) return;
      setRows(queue);
      setDrafts(saved);
      setLoaded(true);
    } catch {
      if (mine === latest.current) setLoaded(false);
    }
  }, []);

  useEffect(() => {
    setRows([]);
    setDrafts([]);
    setLoaded(false);
    void refresh();
  }, [refresh, userId, isOnline, syncing, active.length, lastSyncedAt]);

  const byId = (rowId: number) => rows.find((r) => r.rowId === rowId) ?? null;
  const retry = useCallback(
    async (rowId: number) => {
      await retryQueued(rowId);
      void flushPmCompletions().then(refresh);
      await refresh();
    },
    [refresh],
  );
  const submitDespiteConflict = useCallback(
    async (rowId: number) => {
      const row = byId(rowId);
      if (row && (await submitAnyway(row))) void flushPmCompletions().then(refresh);
      await refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, rows],
  );
  const discard = useCallback(
    async (rowId: number) => {
      const row = byId(rowId);
      if (row) await discardQueued(row);
      await refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, rows],
  );

  return { rows, drafts, active, loaded, refresh, retry, submitDespiteConflict, discard };
}
