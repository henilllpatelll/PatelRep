import type { Room } from "@/stores/appStore";
import { useCleanSessionStore, type ActionResult } from "@/stores/cleanSessionStore";

/**
 * Finishes a stayover/pickup room from a context that has no linen-count UI
 * (the Home hold-to-confirm sheet). DEP rooms need linen_out/linen_in entry and
 * always route through the room detail screen instead — never call this for one.
 *
 * Completion goes through the room's persistent clean session so the server
 * validates the required checklist items and performs the single IN_PROGRESS →
 * CLEAN transition. The result says whether the server confirmed it.
 */
export async function markRoomClean(room: Pick<Room, "id" | "status">): Promise<ActionResult> {
  const store = useCleanSessionStore.getState();
  await store.restoreForRoom(room);
  return store.completeSession(room.id);
}
