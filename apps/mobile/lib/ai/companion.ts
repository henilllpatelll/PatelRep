import type { Room } from "@/stores/appStore";
import { buildSmartQueue } from "@/lib/ai/briefing";
import { getRoomQueueBucket, isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";

/* ─── Shift companion ────────────────────────────────────────────────────────
   The calm, supportive layer behind the Home tab. Everything here is
   deterministic and on-device: it reads the same room data the queue uses and
   turns it into a check-in message, one gentle tip, and glance analytics.
   The paid AI briefing stays a separate, explicit action (lib/ai/briefing). */

const DONE_STATUSES = new Set(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

export type ShiftStage = "empty" | "fresh" | "early" | "mid" | "late" | "done";

export interface ShiftSnapshot {
  total: number;
  done: number;
  remaining: number;
  pct: number;
  vipLeft: number;
  attention: number;
  arrivals: number;
  dndCount: number;
  /** Sum of per-room estimates for everything still cleanable */
  minutesLeft: number;
  /** Locale-formatted clock time the shift is on track to finish, if any work remains */
  finishByLabel: string | null;
  stage: ShiftStage;
}

export function buildShiftSnapshot(rooms: Room[], locale: string, now: Date = new Date()): ShiftSnapshot {
  const total = rooms.length;
  const done = rooms.filter((room) => DONE_STATUSES.has(room.status)).length;
  const remaining = Math.max(0, total - done);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const queue = buildSmartQueue(rooms, now);
  const minutesLeft = queue.reduce((sum, entry) => sum + entry.estimateMinutes, 0);

  const open = rooms.filter((room) => !DONE_STATUSES.has(room.status));
  const vipLeft = open.filter((room) => room.vip_flag).length;
  const attention = rooms.filter((room) => getRoomQueueBucket(room, now) === "needs_attention").length;
  const arrivals = open.filter((room) => isArrivalSoon(room, now)).length;
  const dndCount = open.filter((room) => room.dnd_flag).length;

  const finishByLabel =
    minutesLeft > 0
      ? new Date(now.getTime() + minutesLeft * 60000).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : null;

  let stage: ShiftStage;
  if (total === 0) stage = "empty";
  else if (remaining === 0) stage = "done";
  else if (done === 0) stage = "fresh";
  else if (pct < 40) stage = "early";
  else if (pct < 75) stage = "mid";
  else stage = "late";

  return { total, done, remaining, pct, vipLeft, attention, arrivals, dndCount, minutesLeft, finishByLabel, stage };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface CompanionCheckin {
  /** The supportive headline that follows the greeting */
  message: string;
  /** At most one gentle, situation-aware nudge — never a list of problems */
  tip: string | null;
}

export function getCompanionCheckin(snapshot: ShiftSnapshot, t: Translate): CompanionCheckin {
  const message = {
    empty: t("home.companion.empty"),
    fresh: t("home.companion.fresh"),
    early: t("home.companion.early", { done: snapshot.done }),
    mid: t("home.companion.mid", { done: snapshot.done, total: snapshot.total }),
    late: t("home.companion.late", { count: snapshot.remaining }),
    done: t("home.companion.done"),
  }[snapshot.stage];

  let tip: string | null = null;
  if (snapshot.stage !== "done" && snapshot.stage !== "empty") {
    if (snapshot.attention > 0) tip = t("home.companion.tipAttention", { count: snapshot.attention });
    else if (snapshot.dndCount > 0) tip = t("home.companion.tipDnd", { count: snapshot.dndCount });
    else if (snapshot.arrivals > 0) tip = t("home.companion.tipArrivals", { count: snapshot.arrivals });
    else if (snapshot.vipLeft > 0) tip = t("home.companion.tipVip", { count: snapshot.vipLeft });
    else if (snapshot.stage === "mid" || snapshot.stage === "late") tip = t("home.companion.tipBreather");
  }

  return { message, tip };
}

/** Time-of-day greeting key, so the hero reads naturally across shifts. */
export function getGreetingKey(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "home.greetingMorning";
  if (hour < 17) return "home.greetingAfternoon";
  return "home.greetingEvening";
}
