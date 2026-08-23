import { api } from "@/lib/api/client";
import { useAppStore, type OfflineAction, type Room } from "@/stores/appStore";

/**
 * Marks a stayover/pickup room clean from a context that has no linen-count UI
 * (the Home hold-to-confirm sheet). DEP rooms need linen_out/linen_in entry and
 * always route through the room detail screen instead — never call this for one.
 */
export async function markRoomClean(
  room: Room,
  opts: {
    isOnline: boolean;
    enqueueAction: (action: Omit<OfflineAction, "id" | "createdAt">) => Promise<void>;
  },
): Promise<void> {
  const payload = { status: "CLEAN" as const };
  if (opts.isOnline) {
    await api.patch(`/rooms/${room.id}/status`, payload);
  } else {
    await opts.enqueueAction({ type: "room_status", entityId: room.id, payload });
  }
  useAppStore.getState().resetRoomChecklist(room.id);
}
