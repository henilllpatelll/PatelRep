import { resetFailedSyncQueueAttempts } from "@/lib/offline/db";
import { syncOnConnect } from "@/lib/offline/sync";
import { loadSyncRows } from "@/lib/housekeeping/syncDetails";
import { useAppStore } from "@/stores/appStore";

/**
 * "Retry sync" from the Sync Status drawer. It is the same single, ordered
 * flush the app runs when the connection returns (clean sessions first: start,
 * checklist, complete; then tasks, queued actions, the work-order queue) — not a
 * second engine. Each queue re-checks who owns its items, conflicts are left
 * for the person to resolve, and a call made while one is running joins it.
 */

export type SyncRunResult =
  | { ran: false; reason: "offline" | "failed" }
  | { ran: true; remaining: number; failed: number; conflicts: number; verified: boolean };

let running: Promise<SyncRunResult> | null = null;

export function isSyncRunning(): boolean {
  return running !== null;
}

export function runSyncNow(): Promise<SyncRunResult> {
  if (running) return running;
  if (!useAppStore.getState().isOnline) return Promise.resolve({ ran: false, reason: "offline" });

  running = (async (): Promise<SyncRunResult> => {
    try {
      // The person asked: items that ran out of automatic retries get another go.
      await resetFailedSyncQueueAttempts().catch(() => undefined);
      await useAppStore.getState().resetFailedActions().catch(() => undefined);
      await syncOnConnect();
      const { rows, complete } = await loadSyncRows();
      const weight = (row: { count?: number }) => row.count ?? 1;
      return {
        ran: true,
        remaining: rows.filter((row) => row.state === "pending" || row.state === "retrying").reduce((sum, row) => sum + weight(row), 0),
        failed: rows.filter((row) => row.state === "failed").reduce((sum, row) => sum + weight(row), 0),
        conflicts: rows.filter((row) => row.state === "conflict").reduce((sum, row) => sum + weight(row), 0),
        verified: complete,
      };
    } catch {
      return { ran: false, reason: "failed" };
    } finally {
      running = null;
    }
  })();
  return running;
}
