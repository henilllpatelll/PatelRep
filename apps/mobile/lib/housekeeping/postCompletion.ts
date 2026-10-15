import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";

/**
 * "Up next" after a room is submitted, from the same shared ranking Home uses.
 * It is recomputed from the live model each time it is read, so a supervisor's
 * new assignment, a rush or reclean, or a restriction that appeared in the
 * meantime changes the answer. The room just finished is never offered again,
 * and rooms that cannot be entered (DND, declined...) are never in the ranking.
 */
export function nextRoomAfter(model: HomeModel, completedRoomId: string): RoomEntry | null {
  const lead = model.nextRoom?.room.id !== completedRoomId ? model.nextRoom?.entry : null;
  if (lead) return lead;
  return model.dashboard.upNext.find((entry) => entry.room.id !== completedRoomId) ?? null;
}
