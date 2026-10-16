import type { Room } from "@/stores/appStore";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { Recommendation, RecommendationReason } from "@/lib/housekeeping/homeRecommendation";
import type { AttentionPreviewItem, ConnectionNotice } from "@/lib/housekeeping/homeState";
import type { ShiftLifecycleState } from "@/lib/housekeeping/shiftLifecycle";
import { formatHotelTime, formatShiftDate, isValidTimeZone } from "@/lib/housekeeping/hotelTime";
import {
  cleanTypeLabel,
  describeArrival,
  describeAttention,
  describeReclean,
  describeRush,
  formatClock,
  locationLabel,
  type TextContext,
  type Translate,
} from "@/lib/housekeeping/myRoomsText";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";

/**
 * Wording for the housekeeper Home. Pure functions from structured model data to
 * short strings in the person's language and the hotel's time. Nothing here
 * decides anything: order, access and counts come from the HomeModel.
 */

export type DayPart = "morning" | "afternoon" | "evening";

/** The hotel's local hour (0-23); the device zone only until the hotel's is known. */
export function hotelHour(zone: string | null | undefined, now: Date): number {
  if (!isValidTimeZone(zone)) return now.getHours();
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isFinite(hour) ? hour % 24 : now.getHours();
}

export function dayPartOf(zone: string | null | undefined, now: Date): DayPart {
  const hour = hotelHour(zone, now);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function firstNameOf(name?: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/** "WEDNESDAY, OCT 14 · MORNING" */
export function headerMeta(model: HomeModel, language: string, part: DayPart, t: Translate): string {
  const date = formatShiftDate(model.shiftDate, language);
  // Long month names crowd small phones; the meta line abbreviates by locale rules.
  const short = date ? shortDate(model.shiftDate, language) : null;
  const label = t(`home.header.part.${part}`);
  return [short, label].filter(Boolean).join(" · ").toUpperCase();
}

function shortDate(ymd: string, language: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const locale = language.toLowerCase().startsWith("es") ? "es-US" : "en-US";
  return date.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

const SHIFT_LINE: Record<ShiftLifecycleState, string> = {
  unknown: "home.header.shift.unknown",
  not_started: "home.header.shift.notStarted",
  active: "home.header.shift.active",
  on_break: "home.header.shift.onBreak",
  ending: "home.header.shift.ending",
  ended: "home.header.shift.ended",
};

export function shiftStatusLine(state: ShiftLifecycleState, t: Translate): string {
  return t(SHIFT_LINE[state]);
}

/* ─── Sync indicator ────────────────────────────────────────────────────────── */

export type SyncTone = "ok" | "warn" | "alert" | "muted";

export interface SyncIndicator {
  text: string;
  tone: SyncTone;
  /** Ionicons name. Shape carries the meaning as well as colour. */
  icon: "checkmark-circle-outline" | "cloud-upload-outline" | "cloud-offline-outline" | "alert-circle-outline" | "time-outline";
}

/**
 * "All changes synced" is said only when the queues were read, nothing waits,
 * nothing failed, and the room list is fresh. Anything else says what is true.
 */
export function describeSync(model: HomeModel, t: Translate, ctx: TextContext): SyncIndicator {
  const { sync } = model;
  const time = formatClock(sync.lastRefreshAt, ctx);
  if (sync.status === "attention") return { text: t("home.sync.attention"), tone: "alert", icon: "alert-circle-outline" };
  if (!sync.online) {
    const text = sync.pending > 0
      ? t("home.sync.offlinePending", { count: sync.pending })
      : time
        ? t("home.sync.offlineAt", { time })
        : t("home.sync.offline");
    return { text, tone: "warn", icon: "cloud-offline-outline" };
  }
  if (sync.pending > 0) {
    return { text: t("home.sync.pending", { count: sync.pending }), tone: "warn", icon: "cloud-upload-outline" };
  }
  // A queue that could not be read: "nothing waiting" would be a guess, so say so.
  if (!sync.complete) return { text: t("home.sync.checking"), tone: "muted", icon: "time-outline" };
  if (sync.status === "stale") {
    return {
      text: time ? t("home.sync.stale", { time }) : t("home.sync.staleNoTime"),
      tone: "warn",
      icon: "time-outline",
    };
  }
  if (sync.status === "synced") {
    return {
      text: time ? t("home.sync.synced", { time }) : t("home.sync.syncedNoTime"),
      tone: "ok",
      icon: "checkmark-circle-outline",
    };
  }
  return { text: t("home.sync.unknown"), tone: "muted", icon: "time-outline" };
}

export function describeNotice(notice: ConnectionNotice, t: Translate, ctx: TextContext): { title: string; body: string } {
  const time = formatClock(notice.lastRefreshAt, ctx);
  const at = time ? t("home.notice.lastUpdated", { time }) : t("home.notice.notUpdated");
  switch (notice.kind) {
    case "offline":
      return { title: t("home.notice.offlineTitle"), body: `${t("home.notice.offlineBody")} ${at}` };
    case "refresh_failed":
      return { title: t("home.notice.failedTitle"), body: `${t("home.notice.failedBody")} ${at}` };
    default:
      return { title: t("home.notice.staleTitle"), body: at };
  }
}

/* ─── Lead room ─────────────────────────────────────────────────────────────── */

/** "Departure · Floor 2 · Building A" */
export function roomContext(room: Room, t: Translate): string {
  return [cleanTypeLabel(room, t), locationLabel(room, t)].filter(Boolean).join(" · ");
}

const REASON_KEY: Record<RecommendationReason, string> = {
  active_session: "home.why.activeSession",
  assigned_sequence: "home.why.sequence",
  rush: "home.why.rush",
  reclean: "home.why.reclean",
  arrival_soon: "home.why.arrival",
  checkout_verified: "home.why.checkoutVerified",
  queue_order: "home.why.queue",
};

export interface RecommendationCopy {
  /** One short line shown under the room ("Guest arrival at 1:00 PM"). */
  headline: string | null;
  /** The fuller "Why this room?" explanation: verified facts only (reasons, then the estimate). */
  why: string[];
  /** Just the reasons, strongest first. */
  reasons: string[];
  /** The typical-length line, kept apart: it is an estimate, not a reason. */
  estimate: string;
}

/** "Arrival 3:00 PM", using the arrival flag computed when the room was ranked (not the render-time clock). */
function arrivalLine(rec: Recommendation, t: Translate, ctx: TextContext): string | null {
  if (!rec.timing.arrivalSoon) return null;
  const time = formatClock(rec.timing.arrivalAt, ctx);
  return time ? t("rooms.dash.card.arrival", { time }) : null;
}

function reasonLine(reason: RecommendationReason, rec: Recommendation, t: Translate, ctx: TextContext): string {
  const { timing, entry } = rec;
  switch (reason) {
    case "rush": {
      const rush = describeRush(entry, t, ctx);
      return [t("home.why.rush"), rush?.reason, rush?.deadline].filter(Boolean).join(" · ");
    }
    case "reclean":
      return describeReclean(entry, t) ?? t("home.why.reclean");
    case "arrival_soon": {
      const arrival = arrivalLine(rec, t, ctx);
      return arrival ? `${t("home.why.arrival")} ${arrival}` : t("home.why.arrival");
    }
    case "checkout_verified": {
      const time = formatClock(timing.checkoutVerifiedAt, ctx);
      return time ? t("home.why.checkoutVerifiedAt", { time }) : t("home.why.checkoutVerified");
    }
    case "assigned_sequence":
      return timing.sequenceOrder !== null
        ? t("home.why.sequenceAt", { position: timing.sequenceOrder })
        : t("home.why.sequence");
    default:
      return t(REASON_KEY[reason]);
  }
}

const WHY_ESTIMATE_KEY = {
  history: "home.why.estimateHistory",
  room_type: "home.why.estimate",
  general: "home.why.estimateGeneral",
} as const;

export function describeRecommendation(rec: Recommendation, t: Translate, ctx: TextContext = {}): RecommendationCopy {
  const reasons = [rec.reason, ...rec.alsoApplies];
  const reasonLines = reasons.map((reason) => reasonLine(reason, rec, t, ctx));
  // The typical length is an estimate from the room type, never a promise.
  const estimate = t(WHY_ESTIMATE_KEY[rec.timing.estimateBasis], { minutes: rec.timing.estimateMinutes });
  const why = [...reasonLines, estimate];

  let headline: string | null = null;
  if (rec.reason === "arrival_soon") headline = arrivalLine(rec, t, ctx);
  else if (rec.reason === "rush") {
    const rush = describeRush(rec.entry, t, ctx);
    headline = [rush?.reason, rush?.deadline].filter(Boolean).join(" · ") || t("rooms.dash.card.rush");
  } else if (rec.reason === "reclean") headline = describeReclean(rec.entry, t);
  else headline = arrivalLine(rec, t, ctx);
  return { headline, why, reasons: reasonLines, estimate };
}

/** Context line for the compact Up Next row. */
export function describeUpNext(entry: RoomEntry, t: Translate, ctx: TextContext = {}, now: Date = new Date()): string | null {
  const rush = describeRush(entry, t, ctx);
  if (rush) return [t("rooms.dash.card.rush"), rush.deadline].filter(Boolean).join(" · ");
  return describeReclean(entry, t) ?? describeArrival(entry.room, t, ctx, now);
}

/* ─── Attention rows ────────────────────────────────────────────────────────── */

const ROOM_TITLE_CODES = new Set([
  "dnd",
  "do_not_service",
  "service_declined",
  "guest_inside",
  "access_problem",
  "checkout_unverified",
  "come_back_later",
  "reclean",
  "work_order",
  "high_risk",
  "note",
]);

export interface AttentionRowCopy {
  /** "Room 214 · DND" */
  title: string;
  detail: string | null;
}

export function describeAttentionRow(
  row: AttentionPreviewItem,
  note: HomeModel["supervisorInstruction"],
  t: Translate,
  ctx: TextContext,
): AttentionRowCopy {
  const { item, entry } = row;
  if (item.kind === "supervisor_message") {
    return { title: note?.title || t("home.attention.codes.supervisor_message"), detail: note?.body ?? null };
  }
  const label = ROOM_TITLE_CODES.has(item.code)
    ? t(`rooms.dash.attention.${item.code}.title`)
    : t(`home.attention.codes.${item.code}`);
  const room = item.roomNumber ?? entry?.room.room_number ?? null;
  const title = room ? t("home.attention.rowTitle", { room, label }) : label;

  if (item.kind === "room" && entry) {
    if (item.code === "rush_overdue") {
      return { title, detail: describeRush(entry, t, ctx)?.deadline ?? null };
    }
    if (item.code === "reclean") return { title, detail: describeReclean(entry, t) };
    if (item.code === "session_missing") return { title, detail: t("home.attention.sessionMissing") };
    if (ROOM_TITLE_CODES.has(item.code)) {
      const copy = describeAttention(entry, t, ctx);
      const retry = (item.code === "dnd" || item.code === "come_back_later") && item.at ? formatClock(item.at, ctx) : null;
      return { title, detail: retry ? t("home.attention.retryAt", { time: retry }) : (copy.details[0] ?? null) };
    }
  }
  if (item.code === "session_unassigned") return { title, detail: t("home.attention.sessionUnassigned") };
  if (item.code === "sync_conflict") return { title, detail: t("home.attention.syncConflict") };
  if (item.code === "sync_failed") return { title, detail: t("home.attention.syncFailed") };
  return { title, detail: null };
}

/* ─── Misc ──────────────────────────────────────────────────────────────────── */

export function breakSinceLabel(model: HomeModel, language: string): string | null {
  const since = model.lifecycle.onBreakSince;
  return since ? formatHotelTime(since, model.timeZone, language) : null;
}
