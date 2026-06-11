import { api } from "@/lib/api/client";
import type { Room } from "@/stores/appStore";
import {
  compareRoomsForCleaningQueue,
  getBeforeEnterWarnings,
  getRoomQueueBucket,
  isArrivalSoon,
} from "@/lib/housekeeping/roomWorkflow";

export interface ShiftBriefing {
  headline: string;
  /** Room numbers in suggested cleaning order */
  plan: string[];
  watchouts: string[];
  estimatedMinutes: number;
  source: "ai" | "local";
}

export interface SmartQueueEntry {
  room: Room;
  /** 1-based position in the suggested order */
  position: number;
  estimateMinutes: number;
  /** Minutes from now until this room is expected to be finished */
  etaMinutes: number;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const DEFAULT_MINUTES: Record<string, number> = {
  DEP: 30,
  FULL: 25,
  LIGHT: 15,
};

const AI_TIMEOUT_MS = 8000;

export function estimateCleanMinutes(room: Room): number {
  const base = room.rooms?.room_types?.base_clean_minutes;
  if (base && base > 0) return base;
  if (room.status === "PICKUP") return 15;
  if (room.clean_type && DEFAULT_MINUTES[room.clean_type]) return DEFAULT_MINUTES[room.clean_type];
  return 25;
}

/** Actionable rooms (cleanable now or already started), in suggested order,
 *  with per-room ETAs. This is the deterministic engine behind "smart order". */
export function buildSmartQueue(rooms: Room[], now: Date = new Date()): SmartQueueEntry[] {
  const actionable = rooms.filter((room) => {
    const bucket = getRoomQueueBucket(room, now);
    return bucket === "next_to_clean" || bucket === "in_progress";
  });

  const ordered = [...actionable].sort((a, b) => compareRoomsForCleaningQueue(a, b, now));

  let elapsed = 0;
  return ordered.map((room, index) => {
    const estimateMinutes = estimateCleanMinutes(room);
    elapsed += estimateMinutes;
    return { room, position: index + 1, estimateMinutes, etaMinutes: elapsed };
  });
}

/** The room the housekeeper should *start* next: the first startable room in
 *  the queue. An already-in-progress room stays visible as context but is not
 *  the "start with" suggestion (matches the floor workflow contract). */
export function getStartEntry(queue: SmartQueueEntry[]): SmartQueueEntry | null {
  return queue.find((entry) => entry.room.status !== "IN_PROGRESS") ?? queue[0] ?? null;
}

/** Heuristic briefing built entirely on-device. Used when the AI service is
 *  unreachable (offline, no credits, no keys) so the experience never breaks. */
export function buildLocalBriefing(rooms: Room[], t: Translate, now: Date = new Date()): ShiftBriefing {
  const queue = buildSmartQueue(rooms, now);
  const attention = rooms.filter((room) => getRoomQueueBucket(room, now) === "needs_attention");
  const estimatedMinutes = queue.reduce((sum, entry) => sum + entry.estimateMinutes, 0);

  const first = getStartEntry(queue)?.room;
  let headline: string;
  if (!first) {
    headline = attention.length > 0
      ? t("ai.briefing.onlyAttentionLeft", { count: attention.length })
      : t("ai.briefing.allClear");
  } else if (first.vip_flag) {
    headline = t("ai.briefing.startVip", { room: first.room_number });
  } else if (isArrivalSoon(first, now)) {
    headline = t("ai.briefing.startArrival", { room: first.room_number });
  } else {
    headline = t("ai.briefing.startWith", { room: first.room_number });
  }

  const watchouts: string[] = [];
  const dndCount = rooms.filter((room) => room.dnd_flag).length;
  if (dndCount > 0) watchouts.push(t("ai.briefing.dndWatchout", { count: dndCount }));
  const woCount = rooms.filter((room) => room.open_work_order_id || room.open_work_order_number).length;
  if (woCount > 0) watchouts.push(t("ai.briefing.woWatchout", { count: woCount }));
  const arrivals = rooms.filter((room) => isArrivalSoon(room, now)).length;
  if (arrivals > 0) watchouts.push(t("ai.briefing.arrivalWatchout", { count: arrivals }));

  return {
    headline,
    plan: queue.slice(0, 6).map((entry) => entry.room.room_number),
    watchouts: watchouts.slice(0, 3),
    estimatedMinutes,
    source: "local",
  };
}

function toBriefingPayload(rooms: Room[], now: Date) {
  return rooms.slice(0, 60).map((room) => ({
    room_number: room.room_number,
    status: room.status,
    clean_type: room.clean_type ?? null,
    vip_flag: Boolean(room.vip_flag),
    dnd_flag: Boolean(room.dnd_flag),
    guest_may_be_inside: getBeforeEnterWarnings(room, now).some((w) => w.key === "occupied"),
    open_work_order: Boolean(room.open_work_order_id || room.open_work_order_number),
    checkin_time: room.checkin_time ?? null,
    actual_checkout_at: room.actual_checkout_at ?? null,
    base_clean_minutes: room.rooms?.room_types?.base_clean_minutes ?? null,
  }));
}

/** Ask the backend AI for a briefing; falls back to the local heuristic on
 *  any failure or timeout. Never throws. */
export async function fetchShiftBriefing(
  rooms: Room[],
  language: "en" | "es",
  t: Translate,
  isOnline: boolean,
): Promise<ShiftBriefing> {
  const now = new Date();
  if (!isOnline || rooms.length === 0) return buildLocalBriefing(rooms, t, now);

  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("briefing timeout")), AI_TIMEOUT_MS);
    });
    const request = api.post<{ data: { headline: string; plan: string[]; watchouts: string[]; estimated_minutes: number } }>(
      "/ai/housekeeping/briefing",
      { rooms: toBriefingPayload(rooms, now), language },
    );
    const response = await Promise.race([request, timeout]);
    const data = response.data;
    if (!data?.headline) throw new Error("empty briefing");
    return {
      headline: data.headline,
      plan: Array.isArray(data.plan) ? data.plan.slice(0, 6) : [],
      watchouts: Array.isArray(data.watchouts) ? data.watchouts.slice(0, 3) : [],
      estimatedMinutes: Number(data.estimated_minutes) || 0,
      source: "ai",
    };
  } catch {
    return buildLocalBriefing(rooms, t, now);
  }
}

export interface RoomInsight {
  lines: Array<{ key: string; text: string }>;
  etaMinutes: number;
}

/** Per-room insight for the detail screen — deterministic, instant, offline-safe. */
export function buildRoomInsight(room: Room, allRooms: Room[], t: Translate, now: Date = new Date()): RoomInsight {
  const lines: Array<{ key: string; text: string }> = [];
  const eta = estimateCleanMinutes(room);

  const queue = buildSmartQueue(allRooms, now);
  const entry = queue.find((candidate) => candidate.room.id === room.id);
  if (entry) {
    lines.push({ key: "position", text: t("ai.insight.position", { position: entry.position, count: queue.length }) });
  }
  lines.push({ key: "eta", text: t("ai.insight.eta", { minutes: eta }) });

  if (room.vip_flag) {
    lines.push({ key: "vip", text: t("ai.insight.vip") });
  }
  if (isArrivalSoon(room, now)) {
    lines.push({ key: "arrival", text: t("ai.insight.arrival") });
  }
  if (room.clean_type === "DEP" && room.actual_checkout_at) {
    lines.push({ key: "checkedOut", text: t("ai.insight.checkedOut") });
  }
  if (room.risk_level === "HIGH") {
    lines.push({ key: "risk", text: t("ai.insight.risk") });
  }

  return { lines: lines.slice(0, 4), etaMinutes: eta };
}
