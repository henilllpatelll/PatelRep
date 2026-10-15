import { useCallback, useEffect, useRef, useState } from "react";
import { isSyncRunning, runSyncNow, type SyncRunResult } from "@/lib/housekeeping/syncRunner";

export interface SyncRunController {
  syncing: boolean;
  /** What the last retry found. Cleared when the drawer is reopened. */
  last: SyncRunResult | null;
  run: () => Promise<void>;
  clearLast: () => void;
}

/** One retry at a time; a tap while it runs does nothing. `onDone` lets Home refresh what the sync changed. */
export function useSyncRun(onDone?: () => void | Promise<void>): SyncRunController {
  const [syncing, setSyncing] = useState(() => isSyncRunning());
  const [last, setLast] = useState<SyncRunResult | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    setLast(null);
    try {
      const result = await runSyncNow();
      if (mounted.current) setLast(result);
      await done.current?.();
    } finally {
      busy.current = false;
      if (mounted.current) setSyncing(false);
    }
  }, []);

  const clearLast = useCallback(() => setLast(null), []);
  return { syncing, last, run, clearLast };
}
