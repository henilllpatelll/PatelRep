import type { Room } from "@/stores/appStore";
import type { AttentionReason, RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

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

export function dateLocale(language?: string): string {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

export function formatClock(value: string | null | undefined, language?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(dateLocale(language), { hour: "numeric", minute: "2-digit" });
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
export function describeAccess(entry: RoomEntry, t: Translate, language?: string): string | null {
  const time = formatClock(entry.access.at, language);
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

export interface AttentionCopy {
  title: string;
  /** Up to two short detail lines. */
  details: string[];
}

function blockerText(note: string | null | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  return text.replace(/^BLOCKER:\s*/, "");
}

export function describeAttention(entry: RoomEntry, t: Translate, language?: string): AttentionCopy {
  const reason: AttentionReason = entry.attention ?? "note";
  const room = entry.room;
  const title = t(`rooms.dash.attention.${reason}.title`);
  const details: string[] = [];

  switch (reason) {
    case "dnd": {
      details.push(t("rooms.dash.attention.dnd.detail"));
      const retry = formatClock(room.dnd_retry_at, language);
      if (retry) details.push(t("rooms.dash.attention.retryAt", { time: retry }));
      if (room.dnd_attempt_count && room.dnd_attempt_count > 0) {
        details.push(t("rooms.dash.attention.attempts", { count: room.dnd_attempt_count }));
      }
      break;
    }
    case "declined":
      details.push(room.service_declined_reason?.trim() || t("rooms.dash.attention.declined.detail"));
      break;
    case "blocker":
      details.push(blockerText(room.latest_note) ?? t("rooms.dash.attention.blocker.detail"));
      break;
    case "reclean": {
      const count = room.reclean_corrections?.length ?? 0;
      details.push(t("rooms.dash.attention.corrections", { count }));
      break;
    }
    case "work_order": {
      const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
      details.push(`${room.open_work_order_title?.trim() || t("rooms.dash.attention.work_order.detail")}${number}`);
      break;
    }
    case "note":
      details.push(room.latest_note?.trim() || t("rooms.dash.attention.note.detail"));
      break;
    default:
      details.push(t(`rooms.dash.attention.${reason}.detail`));
  }
  return { title, details: details.slice(0, 3) };
}

/** Floor/building line shown under the room number. */
export function locationLabel(room: Room, t: Translate): string | null {
  const parts: string[] = [];
  if (room.floor != null) parts.push(t("rooms.dash.card.floor", { floor: room.floor }));
  const building = room.building?.trim();
  if (building) parts.push(t("rooms.dash.card.building", { name: building }));
  return parts.length ? parts.join(" · ") : null;
}

/** "Room 224, rush priority, departure, checked out 10:12 AM, open room" */
export function cardAccessibilityLabel(entry: RoomEntry, t: Translate, language?: string): string {
  const room = entry.room;
  const parts: string[] = [t("rooms.dash.card.room", { room: room.room_number })];
  if (entry.rush) parts.push(t("rooms.dash.card.rushA11y"));
  parts.push(statusLabel(room.status, t));
  const type = cleanTypeLabel(room, t);
  if (type) parts.push(type);
  if (entry.category === "attention") {
    const copy = describeAttention(entry, t, language);
    parts.push(copy.title, ...copy.details);
  } else {
    const access = describeAccess(entry, t, language);
    if (access) parts.push(access);
  }
  parts.push(t("rooms.dash.card.open"));
  return parts.join(", ");
}
