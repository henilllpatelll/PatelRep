import { api } from "@/lib/api/client";
import type { Room } from "@/stores/appStore";

export interface ShiftRecap {
  headline: string;
  /** Short operational note worth flagging for tomorrow, or null. */
  note: string | null;
  source: "ai" | "local";
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const AI_TIMEOUT_MS = 8000;

/** Deterministic, on-device recap built entirely from real myRooms data — the
 *  offline/no-AI fallback. Never invents pace, pass rates, or incidents that
 *  aren't tracked client-side. */
export function buildLocalShiftRecap(rooms: Room[], t: Translate): ShiftRecap {
  const count = rooms.length;
  const vipCount = rooms.filter((room) => room.vip_flag).length;
  const headline = vipCount > 0
    ? t("ai.shiftRecap.localVip", { count, vip: vipCount })
    : t("ai.shiftRecap.local", { count });
  return { headline, note: null, source: "local" };
}

function toRecapPayload(rooms: Room[]) {
  return rooms.slice(0, 60).map((room) => ({
    room_number: room.room_number,
    status: room.status,
    clean_type: room.clean_type ?? null,
    base_clean_minutes: room.rooms?.room_types?.base_clean_minutes ?? null,
  }));
}

/** Ask the backend AI for an end-of-shift recap; falls back to the local
 *  heuristic on any failure or timeout. Never throws. */
export async function fetchShiftRecap(
  rooms: Room[],
  language: "en" | "es",
  t: Translate,
  isOnline: boolean,
): Promise<ShiftRecap> {
  if (!isOnline || rooms.length === 0) return buildLocalShiftRecap(rooms, t);

  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("shift recap timeout")), AI_TIMEOUT_MS);
    });
    const request = api.post<{ data: { headline: string; note: string } }>(
      "/ai/housekeeping/shift-summary",
      { rooms: toRecapPayload(rooms), language },
    );
    const response = await Promise.race([request, timeout]);
    const data = response.data;
    if (!data?.headline) throw new Error("empty recap");
    return {
      headline: data.headline,
      note: data.note && data.note.trim().length > 0 ? data.note : null,
      source: "ai",
    };
  } catch {
    return buildLocalShiftRecap(rooms, t);
  }
}
