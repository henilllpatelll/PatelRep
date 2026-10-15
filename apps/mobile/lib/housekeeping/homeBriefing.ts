import type { ShiftBriefing } from "@/lib/ai/briefing";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import { isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";

/**
 * The briefing card must never contradict the order Home recommends. The plan
 * and the "start with" headline therefore come from the same dashboard model
 * (supervisor sequence, rush, reclean, access rules); the AI, when it answers,
 * may only add its own wording while it agrees with that order.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PLAN_LENGTH = 6;

export function buildBriefingFromModel(model: HomeModel, t: Translate): ShiftBriefing {
  const { dashboard } = model;
  const working = [...dashboard.current, ...dashboard.upNext];
  const first = dashboard.upNext[0]?.room;

  let headline: string;
  if (!first) {
    const attention = dashboard.attention.length;
    headline = attention > 0 ? t("ai.briefing.onlyAttentionLeft", { count: attention }) : t("ai.briefing.allClear");
  } else if (model.recommendation?.timing.arrivalSoon && model.recommendation.room.id === first.id) {
    headline = t("ai.briefing.startArrival", { room: first.room_number });
  } else {
    headline = t("ai.briefing.startWith", { room: first.room_number });
  }

  const open = [...working, ...dashboard.attention];
  const watchouts: string[] = [];
  const dnd = open.filter((entry) => entry.room.dnd_flag).length;
  if (dnd > 0) watchouts.push(t("ai.briefing.dndWatchout", { count: dnd }));
  const workOrders = open.filter((entry) => entry.room.open_work_order_id || entry.room.open_work_order_number).length;
  if (workOrders > 0) watchouts.push(t("ai.briefing.woWatchout", { count: workOrders }));
  if (model.alerts.arrivalsSoon > 0) watchouts.push(t("ai.briefing.arrivalWatchout", { count: model.alerts.arrivalsSoon }));

  return {
    headline,
    plan: working.slice(0, PLAN_LENGTH).map((entry) => entry.room.room_number),
    watchouts: watchouts.slice(0, 3),
    estimatedMinutes: working.reduce((sum, entry) => sum + entry.estimateMinutes, 0),
    source: "local",
  };
}

/** Room-number-looking tokens (3-4 digits); times and counts are shorter, so they never trip this. */
const ROOM_TOKEN = /\b\d{3,4}[A-Za-z]?\b/g;

/** True when the text names a room that is not on this person's list. */
export function mentionsUnknownRoom(text: string, knownRooms: readonly string[]): boolean {
  const known = new Set(knownRooms.map((room) => room.toLowerCase()));
  return (text.match(ROOM_TOKEN) ?? []).some((token) => !known.has(token.toLowerCase()));
}

/** True when the text names any of these rooms. */
export function mentionsAnyRoom(text: string, rooms: readonly string[]): boolean {
  if (rooms.length === 0) return false;
  const set = new Set(rooms.map((room) => room.toLowerCase()));
  return (text.match(ROOM_TOKEN) ?? []).some((token) => set.has(token.toLowerCase()));
}

/** Rooms nobody should be sent to right now: held (DND, declined...), out of service, or waiting on a supervisor. */
export function restrictedRoomNumbers(model: HomeModel): string[] {
  const { dashboard } = model;
  return [...dashboard.attention, ...dashboard.unavailable].map((entry) => entry.room.room_number);
}

/**
 * Keep the AI's briefing only if its first room is the one Home recommends;
 * otherwise show the deterministic one. Either way the plan shown is Home's own.
 * When the assigned room numbers are known, AI wording that names any other
 * room is dropped: the AI may phrase the day, never invent a room.
 */
export function reconcileBriefing(
  ai: ShiftBriefing,
  authoritative: ShiftBriefing,
  knownRooms?: readonly string[],
  /** Rooms that must never be recommended; AI wording that names one is dropped, whatever it says about it. */
  restrictedRooms: readonly string[] = [],
): ShiftBriefing {
  if (ai.source !== "ai") return authoritative;
  const agrees = ai.plan.length > 0 && authoritative.plan.length > 0 && ai.plan[0] === authoritative.plan[0];
  if (!agrees) return authoritative;
  if (knownRooms && mentionsUnknownRoom(ai.headline, knownRooms)) return authoritative;
  if (mentionsAnyRoom(ai.headline, restrictedRooms)) return authoritative;
  const watchouts = ai.watchouts.filter(
    (line) => !(knownRooms && mentionsUnknownRoom(line, knownRooms)) && !mentionsAnyRoom(line, restrictedRooms),
  );
  return {
    ...ai,
    watchouts,
    plan: authoritative.plan,
    estimatedMinutes: authoritative.estimatedMinutes || ai.estimatedMinutes,
  };
}

/* ─── The plan, with the reason each room is where it is ────────────────────── */

export type BriefingReason = "active" | "arrival" | "reclean" | "rush" | "queue";

export interface BriefingPlanEntry {
  roomId: string;
  roomNumber: string;
  reason: BriefingReason;
  /** Guest arrival time (ISO) when the reason is "arrival". */
  arrivalAt: string | null;
}

/**
 * The suggested order, straight from the shared dashboard: the open room first,
 * then the rooms Home would offer next. Restricted rooms (DND, declined...) are
 * never in it, so nothing here can send someone through a door they must not
 * open. Each room carries only a true reason from the model.
 */
export function buildBriefingPlan(model: HomeModel, now: Date, limit = PLAN_LENGTH): BriefingPlanEntry[] {
  const { dashboard } = model;
  const working = [...dashboard.current.filter((entry) => entry.session?.state !== "completing"), ...dashboard.upNext];
  return working.slice(0, limit).map((entry) => {
    let reason: BriefingReason = "queue";
    if (dashboard.current.includes(entry)) reason = "active";
    else if (entry.rush) reason = "rush";
    else if (entry.classification.reclean) reason = "reclean";
    else if (isArrivalSoon(entry.room, now)) reason = "arrival";
    return {
      roomId: entry.room.id,
      roomNumber: entry.room.room_number,
      reason,
      arrivalAt: reason === "arrival" ? (entry.room.checkin_time ?? null) : null,
    };
  });
}
