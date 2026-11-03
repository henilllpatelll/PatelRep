import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import {
  deleteSyncQueueItem,
  getPendingSyncQueue,
  incrementSyncQueueAttempts,
  markSyncQueueItemRefused,
} from "@/lib/offline/db";
import { getQueueOwner } from "@/lib/offline/queueOwner";
import { flushSessions } from "@/lib/housekeeping/sessionGuard";
import { flushTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { countPendingChanges } from "@/lib/housekeeping/syncDetails";
import { recordConfirmedSync } from "@/lib/offline/lastSync";
import { classifyClaimError, isTerminalClaimFailure } from "@/lib/engineering/workQueue";
import { recordClaimConflict, type ClaimConflictReason } from "@/lib/engineering/claimConflicts";
import { classifyReplayFailure, reconcileCompletion } from "@/lib/engineering/offlineActions";
import { getWorkOrder } from "@/lib/api/workOrders";
import { REPORT_QUEUE_MARK, isTerminalReportFailure, recordReport } from "@/lib/engineering/pendingReports";
import { clearCompletionDraft } from "@/lib/engineering/workOrderDrafts";
import { recordSynced } from "@/lib/engineering/syncedHistory";
import { PM_QUEUE_ENTITY } from "@/lib/engineering/pmCompletionQueue";
import { flushPmCompletions, sweepPmPhotos } from "@/lib/engineering/pmSyncRunner";

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
  // Saved PM inspections have their own dependency-ordered replay (photos, then the completion); the generic queue
  // above skips them, because it deletes any row it has no branch for.
  await flushPmCompletions();
  void sweepPmPhotos();
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
      label?: string | null;
    }>;

    for (const item of items) {
      // Rows are the signed-in person's own; stop the moment someone else (or nobody) is signed in.
      if (!owner || getQueueOwner() !== owner) break;
      if (item.entity_type === PM_QUEUE_ENTITY) continue; // owned by pmSyncRunner, never deleted from here
      try {
        const payload = JSON.parse(item.payload);

        if (item.entity_type === "room_status" && item.action === "update") {
          await api.patch(`/rooms/${item.entity_id}/status`, payload);
        } else if (item.entity_type === "task" && item.action === "create") {
          await api.post("/tasks", payload);
        } else if (item.entity_type === "work_order" && item.action === "create" && item.entity_id?.startsWith(REPORT_QUEUE_MARK)) {
          // An engineering report: the payload carries its client_request_id, so a replay can never make a second order.
          const requestId = item.entity_id.slice(REPORT_QUEUE_MARK.length);
          try {
            const res = await api.post<{ data?: { id?: string; work_order_number?: string | number | null } | null }>("/work-orders", payload);
            await recordReport({
              requestId,
              kind: "synced",
              title: typeof payload?.title === "string" ? payload.title : "",
              workOrderId: res?.data?.id ?? null,
              workOrderNumber: res?.data?.work_order_number != null ? String(res.data.work_order_number) : null,
            });
          } catch (err) {
            // The server refused it for good (validation, a room that no longer exists): retrying cannot help, so
            // drop it and tell the person instead of leaving a report that looks pending forever.
            if (!isTerminalReportFailure(err)) throw err;
            await recordReport({
              requestId,
              kind: "refused",
              title: typeof payload?.title === "string" ? payload.title : "",
              message: err instanceof Error ? err.message : null,
            });
            await deleteSyncQueueItem(item.id);
            continue;
          }
        } else if (item.entity_type === "work_order" && item.action === "create") {
          await api.post("/work-orders", payload);
        } else if (item.entity_type === "work_order" && item.action === "update") {
          await api.patch(`/work-orders/${item.entity_id}`, payload);
        } else if (item.entity_type === "work_order" && item.action === "claim") {
          try {
            await api.post(`/work-orders/${item.entity_id}/claim`, {});
            if (item.entity_id) await recordSynced({ woId: item.entity_id, kind: "claim", label: typeof payload?.label === "string" ? payload.label : null });
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
          try {
            await api.post(`/work-orders/${item.entity_id}/complete`, payload);
            // The server accepted it: only now does the saved draft (kept while this was merely queued) go away.
            if (item.entity_id) {
              await clearCompletionDraft(item.entity_id);
              await recordSynced({ woId: item.entity_id, kind: "complete", label: item.label ?? null });
            }
          } catch (err) {
            const failure = classifyReplayFailure(err);
            if (failure === "retry") throw err; // network / server trouble: bounded retries, never a silent success
            if (failure === "conflict") {
              // The reply to an earlier attempt may have been lost: confirm against the server before calling it a conflict.
              try {
                const order = await getWorkOrder(String(item.entity_id));
                if (reconcileCompletion(order, useAppStore.getState().user?.id ?? null) === "confirmed") {
                  await clearCompletionDraft(String(item.entity_id));
                  await recordSynced({ woId: String(item.entity_id), kind: "complete", label: item.label ?? null });
                  await deleteSyncQueueItem(item.id);
                  continue;
                }
              } catch {
                throw err; // could not verify: leave it queued rather than guess
              }
            }
            // Refused for good: keep what was saved (notes), stop replaying, let the person decide.
            await markSyncQueueItemRefused(item.id, failure);
            continue;
          }
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
