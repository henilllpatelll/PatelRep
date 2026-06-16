import { api } from "@/lib/api/client";
import type { Room } from "@/stores/appStore";
import {
  getBeforeEnterWarnings,
  getCleaningQueueScore,
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

// -- Proximity routing helpers --

// Elevator/stair cost expressed in "corridor-step" units so floor changes
// are penalised proportionally to the walking detour they cause.
const FLOOR_TRAVEL_COST = 15;

// Buildings share no internal corridor — staff must cross the outdoor courtyard.
// Cost is set above the maximum within-building room spread so the algorithm
// always prefers finishing one building before starting the other.
const BUILDING_CROSS_COST = 50;

function roomSuffix(room: Room): number {
  const digits = room.room_number.replace(/\D/g, "");
  const n = parseInt(digits, 10) || 0;
  // Last two digits give the in-floor corridor position for standard numbering
  // (101-116 = Building A, 117-139 = Building B in the pilot hotel).
  const suffix = n % 100;
  return suffix > 0 ? suffix : n;
}

// Building A: suffix 01-16 (rooms x01-x16). Building B: suffix 17-39 (rooms x17-x39).
function getBuilding(room: Room): "A" | "B" {
  return roomSuffix(room) <= 16 ? "A" : "B";
}

function roomProximityDistance(a: Room, b: Room): number {
  const floorDiff = Math.abs((a.floor || 0) - (b.floor || 0));
  const posDiff = Math.abs(roomSuffix(a) - roomSuffix(b));
  const buildingCross = getBuilding(a) !== getBuilding(b) ? BUILDING_CROSS_COST : 0;
  return floorDiff * FLOOR_TRAVEL_COST + posDiff + buildingCross;
}

function nearestNeighborRoute(rooms: Room[], startFrom: Room | null): Room[] {
  if (rooms.length <= 1) return [...rooms];

  const unvisited = [...rooms];
  const route: Room[] = [];

  if (startFrom !== null) {
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < unvisited.length; i++) {
      const d = roomProximityDistance(startFrom, unvisited[i]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    route.push(unvisited.splice(nearestIdx, 1)[0]);
  } else {
    route.push(unvisited.splice(0, 1)[0]);
  }

  while (unvisited.length > 0) {
    const current = route[route.length - 1];
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < unvisited.length; i++) {
      const d = roomProximityDistance(current, unvisited[i]);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    route.push(unvisited.splice(nearestIdx, 1)[0]);
  }

  return route;
}

/** Actionable rooms in an efficient cleaning order.
 *
 *  Algorithm:
 *  1. Group rooms by priority tier (getCleaningQueueScore buckets).
 *  2. Within each tier, secondary-sort by checkout time then room number,
 *     then apply a greedy nearest-neighbor pass to minimise corridor and
 *     floor travel.
 *  3. Chain tiers so the starting position of the next tier is the last
 *     room cleaned in the previous tier, preserving continuity of movement.
 *
 *  Priority is never compromised: a higher-tier room always comes before an
 *  adjacent lower-tier room regardless of physical proximity. */
export function buildSmartQueue(rooms: Room[], now: Date = new Date()): SmartQueueEntry[] {
  const actionable = rooms.filter((room) => {
    const bucket = getRoomQueueBucket(room, now);
    return bucket === "next_to_clean" || bucket === "in_progress";
  });

  if (actionable.length === 0) return [];

  // Group into discrete priority tiers
  const tierMap = new Map<number, Room[]>();
  for (const room of actionable) {
    const score = getCleaningQueueScore(room, now);
    if (!tierMap.has(score)) tierMap.set(score, []);
    tierMap.get(score)!.push(room);
  }

  const sortedScores = [...tierMap.keys()].sort((a, b) => a - b);
  const ordered: Room[] = [];
  // Only chain tiers when a real physical position exists (an IN_PROGRESS room).
  // On a fresh day with nothing started, each tier picks its own entry point so
  // the arbitrary end of one tier does not distort the start of the next.
  const hasInProgress = actionable.some((r) => r.status === "IN_PROGRESS");
  let lastRoom: Room | null = null;

  for (const score of sortedScores) {
    const tier = tierMap.get(score)!;
    // Secondary sort gives a stable starting sequence for the greedy pass
    tier.sort((a, b) => {
      // Rooms with an actual checkout sort before rooms that haven't checked out yet.
      // null treated as Infinity so "not yet checked out" always comes last.
      const at = a.actual_checkout_at ? new Date(a.actual_checkout_at).getTime() : Infinity;
      const bt = b.actual_checkout_at ? new Date(b.actual_checkout_at).getTime() : Infinity;
      if (at !== bt) return at - bt;
      return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
    });
    const routed = nearestNeighborRoute(tier, lastRoom);
    ordered.push(...routed);
    if (hasInProgress) lastRoom = routed[routed.length - 1] ?? lastRoom;
  }

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
