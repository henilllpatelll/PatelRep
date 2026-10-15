import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSyncRows, type SyncRow } from "@/lib/housekeeping/syncDetails";
import { useSyncRun } from "@/lib/housekeeping/useSyncRun";
import { useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { useSyncActivity } from "@/lib/offline/sync";
import { buildOverview } from "@/lib/offline/syncOverview";
import { useAppStore } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";

interface Loaded {
  userId: string | null;
  rows: SyncRow[];
  complete: boolean;
}

/**
 * Settings' view of the real queues. It only observes: the queues keep their own storage, ownership and
 * retry rules, and "Sync now" is the app's single ordered flush (runSyncNow). It re-reads when any queue
 * store changes, when the connection changes and after every sync; nothing polls.
 */
export function useSyncOverview() {
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const actions = useAppStore((s) => s.pendingActions);
  const sessions = useCleanSessionStore((s) => s.sessions);
  const outbox = useTaskOutbox((s) => s.entries);
  const activeSync = useSyncActivity((s) => s.active);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const latest = useRef(0);
  const mounted = useRef(true);
  const userId = user?.id ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const result = await loadSyncRows();
    // A newer read, or another person signing in, makes this answer stale.
    if (!mounted.current || mine !== latest.current) return;
    setLoaded({ userId: useAppStore.getState().user?.id ?? null, rows: result.rows, complete: result.complete });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, userId, actions, sessions, outbox, isOnline, activeSync]);

  const run = useSyncRun(refresh);

  const fresh = loaded && loaded.userId === userId ? loaded : null;
  const overview = useMemo(
    () =>
      buildOverview({
        rows: fresh?.rows ?? [],
        complete: fresh?.complete ?? false,
        loaded: fresh !== null,
        online: isOnline,
        syncing: run.syncing || activeSync,
        lastSyncedAt,
        role: user?.effective_role ?? user?.role ?? null,
      }),
    [fresh, isOnline, run.syncing, activeSync, lastSyncedAt, user?.effective_role, user?.role],
  );

  return { overview, refresh, syncing: run.syncing || activeSync, lastRun: run.last, runSync: run.run, clearLastRun: run.clearLast };
}
