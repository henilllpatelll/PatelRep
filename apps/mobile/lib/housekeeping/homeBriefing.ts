import type { ShiftBriefing } from "@/lib/ai/briefing";
import type { HomeModel } from "@/lib/housekeeping/homeModel";

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

/**
 * Keep the AI's briefing only if its first room is the one Home recommends;
 * otherwise show the deterministic one. Either way the plan shown is Home's own.
 */
export function reconcileBriefing(ai: ShiftBriefing, authoritative: ShiftBriefing): ShiftBriefing {
  if (ai.source !== "ai") return authoritative;
  const agrees = ai.plan.length > 0 && authoritative.plan.length > 0 && ai.plan[0] === authoritative.plan[0];
  if (!agrees) return authoritative;
  return { ...ai, plan: authoritative.plan, estimatedMinutes: authoritative.estimatedMinutes || ai.estimatedMinutes };
}
