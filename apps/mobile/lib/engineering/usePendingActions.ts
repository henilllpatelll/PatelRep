import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSyncQueueItem, getSyncQueueSummary, retrySyncQueueItem } from "@/lib/offline/db";
import { useSyncActivity } from "@/lib/offline/sync";
import { buildPendingActions, type PendingAction } from "@/lib/engineering/offlineActions";
import { useAppStore } from "@/stores/appStore";

/**
 * The signed-in engineer's queued work-order changes, read from the real queue (never invented). Re-reads when the
 * connection, a sync run or the last confirmed sync changes. `loaded` stays false until a read succeeded, so a failed
 * read is never shown as "nothing waiting".
 */
export function usePendingActions() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const isOnline = useAppStore((s) => s.isOnline);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const syncing = useSyncActivity((s) => s.active);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const rows = await getSyncQueueSummary();
      if (mine !== latest.current) return;
      setActions(buildPendingActions(rows));
      setLoaded(true);
    } catch {
      if (mine === latest.current) setLoaded(false);
    }
  }, []);

  useEffect(() => {
    setActions([]);
    setLoaded(false);
    void refresh();
  }, [refresh, userId, isOnline, syncing, lastSyncedAt]);

  const retry = useCallback(
    async (queueId: number) => {
      await retrySyncQueueItem(queueId);
      await refresh();
    },
    [refresh],
  );
  /** Removes an UNSENT change from this phone. It never reverses anything the server already confirmed. */
  const discard = useCallback(
    async (queueId: number) => {
      await deleteSyncQueueItem(queueId);
      await refresh();
    },
    [refresh],
  );

  return { actions, loaded, refresh, retry, discard };
}
