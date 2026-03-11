import NetInfo from "@react-native-community/netinfo";
import { api } from "@/lib/api/client";
import {
  deleteSyncQueueItem,
  getPendingSyncQueue,
  upsertRooms,
} from "@/lib/offline/db";

let _syncInProgress = false;

export async function syncOnConnect(): Promise<void> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  await flushSyncQueue();
  await refreshRooms();
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
        } else if (item.entity_type === "work_order" && item.action === "update") {
          await api.patch(`/work-orders/${item.entity_id}`, payload);
        }

        await deleteSyncQueueItem(item.id);
      } catch (err) {
        // Leave in queue to retry, but increment attempts via separate update if needed
        console.warn("Sync item failed:", item.id, err);
      }
    }
  } finally {
    _syncInProgress = false;
  }
}

export async function refreshRooms(): Promise<void> {
  try {
    const rooms = await api.get<unknown[]>("/rooms?my_rooms=true");
    await upsertRooms(rooms);
  } catch (err) {
    console.warn("Failed to refresh rooms:", err);
  }
}
