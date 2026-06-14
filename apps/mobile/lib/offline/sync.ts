import NetInfo from "@react-native-community/netinfo";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import {
  deleteSyncQueueItem,
  getPendingSyncQueue,
  incrementSyncQueueAttempts,
  upsertRooms,
} from "@/lib/offline/db";
import { localDate } from "@/lib/utils/date";
import type { Room } from "@/stores/appStore";

let _syncInProgress = false;
let _syncOnConnectInProgress = false;

export async function syncOnConnect(): Promise<void> {
  // Guard against concurrent calls — NetInfo fires multiple times on Android.
  // Two concurrent withTransactionAsync on the same connection destroy each other.
  if (_syncOnConnectInProgress) return;
  _syncOnConnectInProgress = true;
  try {
    const state = await NetInfo.fetch();
    if (!state.isConnected) return;
    // Flush both queues: appStore queue (logbook, task_complete, etc.) + SQLite queue
    await useAppStore.getState().flushQueue();
    await flushSyncQueue();
    // Only refresh rooms for housekeepers and supervisors (API endpoint requires it)
    const user = useAppStore.getState().user;
    if (user && (user.role === "housekeeper" || user.role === "housekeeping_supervisor")) {
      await refreshRooms();
    }
  } finally {
    _syncOnConnectInProgress = false;
  }
}

export async function flushSyncQueue(): Promise<void> {
  if (_syncInProgress) return;
  _syncInProgress = true;

  try {
    const items = (await getPendingSyncQueue()) as Array<{
      id: number;
      entity_type: string;
      action: string;
      payload: string;
      entity_id?: string;
    }>;

    for (const item of items) {
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
          await api.post(`/work-orders/${item.entity_id}/claim`, {});
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

export async function refreshRooms(): Promise<void> {
  try {
    const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
    await upsertRooms(result.data);
  } catch (err) {
    console.warn("Failed to refresh rooms:", err);
  }
}
