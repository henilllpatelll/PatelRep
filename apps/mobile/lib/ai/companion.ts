import type { Room } from "@/stores/appStore";
import { isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { buildDashboard, type DashboardModel, type SessionMap } from "@/lib/housekeeping/myRoomsDashboard";

/* ─── Shift companion ────────────────────────────────────────────────────────
   The calm, supportive layer behind the Home tab. Everything here is
   deterministic and on-device: it reads the same dashboard model My Rooms
   renders and turns it into a check-in message, one gentle tip, and glance
   analytics. The paid AI briefing stays a separate, explicit action
   (lib/ai/briefing). */

export type ShiftStage = "empty" | "fresh" | "early" | "mid" | "late" | "done";

export interface ShiftSnapshot {
  /** Serviceable rooms: assigned minus out-of-order/out-of-service (those are never "cleaned"). */
  total: number;
  /** Submitted for inspection or inspected. */
  done: number;
  remaining: number;
  pct: number;
  /** Rooms needing follow-up that is not a guest/front-desk hold (DND and declined service are counted separately). */
  attention: number;
  arrivals: number;
  dndCount: number;
  /** Sum of per-room estimates for everything still cleanable */
  minutesLeft: number;
  /** Locale-formatted clock time the shift is on track to finish, if any work remains */
  finishByLabel: string | null;
  stage: ShiftStage;
}

const HOLD_REASONS = new Set(["dnd", "do_not_service", "service_declined", "come_back_later"]);

/** Shift snapshot for rooms + sessions, via the same dashboard My Rooms builds. */
export function buildShiftSnapshot(
  rooms: Room[],
  locale: string,
  now: Date = new Date(),
  sessions: SessionMap = {},
): ShiftSnapshot {
  return snapshotFromDashboard(buildDashboard(rooms, sessions, now), locale, now);
}

/**
 * Derived from the My Rooms dashboard so Home and My Rooms can never disagree:
 * an out-of-service room is not "done", an inspected room is not double counted,
 * and a failed or empty list is the caller's concern (see homeModel).
 */
export function snapshotFromDashboard(dashboard: DashboardModel, locale: string, now: Date = new Date()): ShiftSnapshot {
  const p = dashboard.progress;
  const total = p.serviceable;
  const done = p.completed;
  const remaining = p.remaining;

  const minutesLeft = [...dashboard.current, ...dashboard.upNext].reduce((sum, entry) => sum + entry.estimateMinutes, 0);
  const open = [...dashboard.current, ...dashboard.upNext, ...dashboard.attention];
  const attention = dashboard.attention.filter((entry) => !HOLD_REASONS.has(entry.attention ?? "")).length;
  const arrivals = open.filter((entry) => isArrivalSoon(entry.room, now)).length;
  const dndCount = open.filter((entry) => entry.room.dnd_flag).length;

  const finishByLabel =
    minutesLeft > 0
      ? new Date(now.getTime() + minutesLeft * 60000).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : null;

  let stage: ShiftStage;
  if (total === 0) stage = "empty";
  else if (remaining === 0) stage = "done";
  else if (done === 0) stage = "fresh";
  else if (p.percent < 40) stage = "early";
  else if (p.percent < 75) stage = "mid";
  else stage = "late";

  return { total, done, remaining, pct: p.percent, attention, arrivals, dndCount, minutesLeft, finishByLabel, stage };
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
