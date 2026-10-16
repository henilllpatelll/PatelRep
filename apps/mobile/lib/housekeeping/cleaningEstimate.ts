import type { Room } from "@/stores/appStore";
import { lookupLearned } from "@/lib/housekeeping/estimateTable";

/**
 * Where a cleaning-time estimate comes from, so the screen can say so.
 *
 * "history" is this hotel's own recent cleans of the same room type and clean type, used only when the API
 * found it predicts newer cleans better than the baseline. "room_type" is the hotel's own baseline for the
 * room type. "general" is the app's fallback when the hotel has not set one for this type: it is shown as a
 * general figure, never as the room's baseline. None of them is a guarantee, a measured duration or a deadline.
 */
export type EstimateBasis = "history" | "room_type" | "general";

export interface CleaningEstimate {
  minutes: number;
  basis: EstimateBasis;
}

const DEFAULT_MINUTES: Record<string, number> = {
  DEP: 30,
  FULL: 25,
  LIGHT: 15,
};

type EstimateRoom = Pick<Room, "rooms"> & Partial<Pick<Room, "status" | "clean_type">>;

/**
 * THE estimate for a room. Home, My Rooms, Room Detail, Why-this-room, the shift briefing and the assistant
 * all read it from here, so one room never shows two different numbers. It never changes which room comes
 * first: ranking, access and priority are decided elsewhere and do not read it.
 */
export function resolveEstimate(room: EstimateRoom): CleaningEstimate {
  const base = room.rooms?.room_types?.base_clean_minutes;
  if (room.status !== "PICKUP") {
    const learned = lookupLearned(room.rooms?.room_types?.code, room.clean_type);
    if (learned) return { minutes: learned.minutes, basis: "history" };
  }
  if (typeof base === "number" && base > 0) return { minutes: base, basis: "room_type" };
  if (room.status === "PICKUP") return { minutes: 15, basis: "general" };
  if (room.clean_type && DEFAULT_MINUTES[room.clean_type]) return { minutes: DEFAULT_MINUTES[room.clean_type], basis: "general" };
  return { minutes: 25, basis: "general" };
}

export function estimateBasisOf(room: EstimateRoom): EstimateBasis {
  return resolveEstimate(room).basis;
}
