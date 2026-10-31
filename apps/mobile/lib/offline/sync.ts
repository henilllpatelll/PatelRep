import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import {
  deleteSyncQueueItem,
  getPendingSyncQueue,
  incrementSyncQueueAttempts,
} from "@/lib/offline/db";
import { getQueueOwner } from "@/lib/offline/queueOwner";
import { flushSessions } from "@/lib/housekeeping/sessionGuard";
import { flushTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { countPendingChanges } from "@/lib/housekeeping/syncDetails";
import { recordConfirmedSync } from "@/lib/offline/lastSync";
import { classifyClaimError, isTerminalClaimFailure } from "@/lib/engineering/workQueue";
import { recordClaimConflict, type ClaimConflictReason } from "@/lib/engineering/claimConflicts";

let _syncInProgress = false;
let _syncOnConnectRun: Promise<void> | null = null;

/** True while the one app-wide sync is running (automatic or manual), so screens can say "Syncing". */
export const useSyncActivity = create<{ active: boolean }>(() => ({ active: false }));

/**
 * One sync at a time, app-wide. NetInfo fires several times on Android and two
 * concurrent withTransactionAsync on the same connection destroy each other, so
 * a call made while one is running joins it (and resolves when it does) rather
 * than starting another or returning early.
 */
export function syncOnConnect(): Promise<void> {
  if (_syncOnConnectRun) return _syncOnConnectRun;
  useSyncActivity.setState({ active: true });
  _syncOnConnectRun = runSyncOnConnect().finally(() => {
    _syncOnConnectRun = null;
    useSyncActivity.setState({ active: false });
  });
  return _syncOnConnectRun;
}

async function runSyncOnConnect(): Promise<void> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  // Clean sessions replay first (start -> checklist -> complete, in order); the
  // generic queue then skips room_status entries a session owns.
  await flushSessions();
  // Saved task completions go through their own per-user outbox (identity re-checked on every item).
  await flushTaskOutbox();
  // Flush both queues: appStore queue (logbook, room status, etc.) + SQLite queue
  await useAppStore.getState().flushQueue();
  await flushSyncQueue();
  // Only refresh rooms for housekeepers and supervisors (API endpoint requires it)
  const user = useAppStore.getState().user;
  if (user && (user.role === "housekeeper" || user.role === "housekeeping_supervisor")) {
    await refreshRooms();
  }
  // "Last sync" only moves when the round-trip left nothing waiting (and is kept for this person across restarts).
  if ((await countPendingChanges()) === 0) await recordConfirmedSync();
}

export async function flushSyncQueue(): Promise<void> {
  if (_syncInProgress) return;
  _syncInProgress = true;

  try {
    const owner = getQueueOwner();
    const items = (await getPendingSyncQueue()) as Array<{
      id: number;
      entity_type: string;
      action: string;
      payload: string;
      entity_id?: string;
    }>;

    for (const item of items) {
      // Rows are the signed-in person's own; stop the moment someone else (or nobody) is signed in.
      if (!owner || getQueueOwner() !== owner) break;
      try {
        const payload = JSON.parse(item.payload);

        if (item.entity_type === "room_status" && item.action === "update") {
          await api.patch(`/rooms/${item.entity_id}/status`, payload);
        } else if (item.entity_type === "task" && item.action === "create") {
          await api.post("/tasks", payload);
        } else if (item.entity_type === "work_order" && item.action === "create") {
          await api.post("/work-orders", payload);
        } else if (item.entity_type === "work_order" && item.action === "update") {
          await api.patch(`/work-orders/${item.entity_id}`, payload);
        } else if (item.entity_type === "work_order" && item.action === "claim") {
          try {
            await api.post(`/work-orders/${item.entity_id}/claim`, {});
          } catch (err) {
            // Someone else claimed it, it is gone, or the role was refused: retrying can never work, so drop it
            // and tell the person instead of leaving a claim that looks pending forever.
            if (!item.entity_id || !isTerminalClaimFailure(err)) throw err;
            await recordClaimConflict({
              woId: item.entity_id,
              label: typeof payload?.label === "string" ? payload.label : null,
              reason: classifyClaimError(err) as ClaimConflictReason,
            });
            await deleteSyncQueueItem(item.id);
            continue;
          }
        } else if (item.entity_type === "work_order" && item.action === "complete") {
          await api.post(`/work-orders/${item.entity_id}/complete`, payload);
        }

        await deleteSyncQueueItem(item.id);
      } catch (err) {
        await incrementSyncQueueAttempts(item.id);
        console.warn("Sync item failed:", item.id, err);
      }
    }
  } finally {
    _syncInProgress = false;
  }
}

/** Reconnect refresh: the store owns the one scoped, date-correct, ordered room refresh. */
export async function refreshRooms(): Promise<void> {
  try {
    await useAppStore.getState().refreshRooms();
  } catch (err) {
    console.warn("Failed to refresh rooms:", err);
  }
}
