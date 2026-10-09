import type { Room } from "@/stores/appStore";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import { isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Language for wording and the hotel's zone for every displayed time. */
export interface TextContext {
  language?: string;
  timeZone?: string | null;
}

const KNOWN_STATUSES = new Set([
  "DIRTY",
  "OCCUPIED",
  "PICKUP",
  "IN_PROGRESS",
  "CLEAN",
  "INSPECTED",
  "OOO",
  "OUT_OF_ORDER",
  "OUT_OF_SERVICE",
]);

const RUSH_REASONS = new Set(["early_arrival", "vip", "guest_waiting", "front_desk_request", "operational_priority", "other"]);
const DECLINE_REASONS = new Set(["guest_declined_housekeeping", "guest_no_service_today", "privacy_request", "other"]);

export function dateLocale(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

/** A timestamp in the hotel's zone (never the device's). */
export function formatClock(value: string | null | undefined, ctx: TextContext = {}): string | null {
  return formatHotelTime(value, ctx.timeZone, ctx.language);
}

export function statusLabel(status: Room["status"], t: Translate): string {
  return t(`rooms.card.status.${KNOWN_STATUSES.has(status) ? status : "UNKNOWN"}`, {
    status: status.replace(/_/g, " "),
  });
}

const TRANSLATED_CLEAN_TYPES = new Set(["DEP", "FULL", "LIGHT"]);

export function cleanTypeLabel(room: Room, t: Translate): string | null {
  if (!room.clean_type) return room.clean_type_label ?? null;
  if (TRANSLATED_CLEAN_TYPES.has(room.clean_type)) return t(`rooms.card.cleanType.${room.clean_type}`);
  // Hotel-specific clean types keep the server's own label.
  return room.clean_type_label ?? room.clean_type;
}

/** The one line that says whether (and how) the room can be entered. */
export function describeAccess(entry: RoomEntry, t: Translate, ctx: TextContext = {}): string | null {
  const time = formatClock(entry.access.at, ctx);
  switch (entry.access.kind) {
    case "dnd":
      return t("rooms.dash.access.dnd");
    case "do_not_service":
      return t("rooms.dash.access.doNotService");
    case "checkout_verified":
      return time ? t("rooms.dash.access.checkoutVerified", { time }) : t("rooms.dash.access.checkoutVerifiedNoTime");
    case "scheduled_checkout":
      return time
        ? t("rooms.dash.access.scheduledCheckout", { time })
        : t("rooms.dash.access.checkoutNotVerified");
    case "checkout_not_verified":
      return t("rooms.dash.access.checkoutNotVerified");
    case "occupied":
      return t("rooms.dash.access.occupied");
    case "vacant":
    default:
      return null;
  }
}

export interface RushCopy {
  /** "Needed by 1:00 PM" / "Overdue — was due 1:00 PM" / null without a deadline. */
  deadline: string | null;
  /** "VIP", "Guest waiting"… when the supervisor gave a reason. */
  reason: string | null;
  overdue: boolean;
}

export function describeRush(entry: RoomEntry, t: Translate, ctx: TextContext = {}): RushCopy | null {
  const rush = entry.rush;
  if (!rush) return null;
  const time = formatClock(rush.neededBy, ctx);
  const deadline = time
    ? rush.overdue
      ? t("rooms.dash.rush.overdue", { time })
      : t("rooms.dash.card.neededBy", { time })
    : null;
  const reason = rush.reason && RUSH_REASONS.has(rush.reason) ? t(`rooms.dash.rush.reasons.${rush.reason}`) : null;
  return { deadline, reason, overdue: rush.overdue };
}

export interface AttentionCopy {
  title: string;
  /** Short detail lines, most important first. */
  details: string[];
}

function stripBlockerPrefix(note: string | null | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  return text.replace(/^BLOCKER:\s*/, "");
}

/** DND / come-back-later specifics: last attempt and attempt count. */
function attemptLines(entry: RoomEntry, t: Translate, ctx: TextContext): string[] {
  const retry = entry.classification.retry;
  if (!retry) return [];
  const lines: string[] = [];
  const last = formatClock(retry.lastAttemptAt, ctx);
  if (last) lines.push(t("rooms.dash.attention.lastAttempt", { time: last }));
  if (retry.attempts > 0) lines.push(t("rooms.dash.attention.attempts", { count: retry.attempts }));
  return lines;
}

export function describeAttention(entry: RoomEntry, t: Translate, ctx: TextContext = {}): AttentionCopy {
  const code = entry.attention ?? entry.classification.primary ?? "note";
  const room = entry.room;
  const title = t(`rooms.dash.attention.${code}.title`);
  const details: string[] = [];
  const retryTime = formatClock(entry.classification.retry?.at, ctx);

  switch (code) {
    case "dnd":
      details.push(t("rooms.dash.attention.dnd.detail"), ...attemptLines(entry, t, ctx));
      if (retryTime) details.push(t("rooms.dash.attention.retryAt", { time: retryTime }));
      break;
    case "come_back_later":
      details.push(
        retryTime
          ? t("rooms.dash.attention.come_back_later.detailAt", { time: retryTime })
          : t("rooms.dash.attention.come_back_later.detail"),
        ...attemptLines(entry, t, ctx),
      );
      break;
    case "service_declined": {
      details.push(
        room.service_declined_reason && DECLINE_REASONS.has(room.service_declined_reason)
          ? t(`rooms.dash.attention.declineReasons.${room.service_declined_reason}`)
          : t("rooms.dash.attention.service_declined.detail"),
      );
      if (room.service_declined_note?.trim()) details.push(room.service_declined_note.trim());
      break;
    }
    case "guest_inside":
    case "access_problem":
      details.push(stripBlockerPrefix(room.latest_note) ?? t(`rooms.dash.attention.${code}.detail`));
      break;
    case "reclean":
      details.push(t("rooms.dash.attention.corrections", { count: entry.classification.reclean?.corrections ?? 0 }));
      break;
    case "work_order": {
      const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
      details.push(`${room.open_work_order_title?.trim() || t("rooms.dash.attention.work_order.detail")}${number}`);
      break;
    }
    case "note":
      details.push(room.latest_note?.trim() || t("rooms.dash.attention.note.detail"));
      break;
    default:
      details.push(t(`rooms.dash.attention.${code}.detail`));
  }

  // The next-strongest condition stays visible instead of being discarded.
  const secondary = entry.classification.reasons.find((reason) => reason !== code);
  if (secondary) details.push(t("rooms.dash.attention.also", { reason: t(`rooms.dash.attention.${secondary}.title`) }));

  return { title, details: details.slice(0, 4) };
}

/** "2 corrections requested" for a reclean that is safe to start. */
export function describeReclean(entry: RoomEntry, t: Translate): string | null {
  const reclean = entry.classification.reclean;
  if (!reclean) return null;
  return reclean.corrections > 0
    ? t("rooms.dash.card.recleanCorrections", { count: reclean.corrections })
    : t("rooms.dash.card.recleanRequested");
}

/** "Arrival 3:00 PM" — the guest's arrival, kept apart from a Rush deadline. */
export function describeArrival(room: Room, t: Translate, ctx: TextContext = {}, now: Date = new Date()): string | null {
  if (!isArrivalSoon(room, now)) return null;
  const time = formatClock(room.checkin_time, ctx);
  return time ? t("rooms.dash.card.arrival", { time }) : null;
}

/** Floor/building line shown under the room number. */
export function locationLabel(room: Room, t: Translate): string | null {
  const parts: string[] = [];
  if (room.floor != null) parts.push(t("rooms.dash.card.floor", { floor: room.floor }));
  const building = room.building?.trim();
  if (building) parts.push(t("rooms.dash.card.building", { name: building }));
  return parts.length ? parts.join(" · ") : null;
}

/** One dominant state word for compact rows (Floors). */
export function compactStateLabel(entry: RoomEntry, t: Translate, ctx: TextContext = {}): string {
  if (entry.category === "attention") {
    const code = entry.attention ?? "note";
    if (code === "come_back_later") {
      const time = formatClock(entry.classification.retry?.at, ctx);
      return time ? t("rooms.dash.floors.comeBackAt", { time }) : t("rooms.dash.attention.come_back_later.title");
    }
    return t(`rooms.dash.attention.${code}.title`);
  }
  if (entry.category === "current") return t("rooms.card.status.IN_PROGRESS");
  if (entry.rush) return t("rooms.dash.card.rush");
  if (entry.classification.reclean) return t("rooms.dash.attention.reclean.title");
  return statusLabel(entry.room.status, t);
}

/** "Room 224, rush priority, departure, checked out 10:12 AM, open room" */
export function cardAccessibilityLabel(entry: RoomEntry, t: Translate, ctx: TextContext = {}): string {
  const room = entry.room;
  const parts: string[] = [t("rooms.dash.card.room", { room: room.room_number })];
  if (entry.rush) {
    parts.push(t("rooms.dash.card.rushA11y"));
    const rush = describeRush(entry, t, ctx);
    if (rush?.deadline) parts.push(rush.deadline);
  }
  if (entry.category === "attention") {
    const copy = describeAttention(entry, t, ctx);
    parts.push(copy.title, ...copy.details);
  } else {
    parts.push(statusLabel(room.status, t));
    const type = cleanTypeLabel(room, t);
    if (type) parts.push(type);
    const reclean = describeReclean(entry, t);
    if (reclean) parts.push(reclean);
    const access = describeAccess(entry, t, ctx);
    if (access) parts.push(access);
  }
  parts.push(t("rooms.dash.card.open"));
  return parts.join(", ");
}
