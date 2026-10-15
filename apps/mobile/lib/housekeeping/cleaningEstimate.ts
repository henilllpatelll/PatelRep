import type { Room } from "@/stores/appStore";

/**
 * Where a cleaning-time estimate comes from, so the screen can say so.
 *
 * "room_type" is the hotel's own baseline for the room type. "general" is the app's fallback when the
 * hotel has not set one for this type: it is shown as a general figure, never as this room's baseline.
 * Neither is a prediction, a measured duration or a deadline.
 */
export type EstimateBasis = "room_type" | "general";

export function estimateBasisOf(room: Pick<Room, "rooms">): EstimateBasis {
  const base = room.rooms?.room_types?.base_clean_minutes;
  return typeof base === "number" && base > 0 ? "room_type" : "general";
}
