import type { Room } from "@/stores/appStore";

export type RoomBadgeKey =
  | "vip"
  | "dnd"
  | "work_order"
  | "note"
  | "risk"
  | "arrival"
  | "checkout";

export type RoomActionKind =
  | "start"
  | "review"
  | "done"
  | "submitted"
  | "ready"
  | "blocked"
  | "view";

export type RoomQueueBucket =
  | "next_to_clean"
  | "needs_attention"
  | "in_progress"
  | "submitted"
  | "ready"
  | "blocked";

export interface RoomBadge {
  key: RoomBadgeKey;
  label: string;
}

export interface RoomAction {
  kind: RoomActionKind;
  label: string;
  targetStatus?: Room["status"];
  allowUndo?: boolean;
  disabled?: boolean;
}

export interface TimingLine {
  label: string;
  value: string;
}

export interface BeforeEnterWarning {
  key: string;
  label: string;
  detail: string;
  severity: "critical" | "warning" | "info";
}

const CLEANABLE_STATUSES = new Set<Room["status"]>(["DIRTY", "PICKUP"]);
const BLOCKED_STATUSES = new Set<Room["status"]>(["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);
const ARRIVAL_SOON_MS = 4 * 60 * 60 * 1000;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value: string | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function hasOpenWorkOrder(room: Room): boolean {
  return Boolean(room.open_work_order_id || room.open_work_order_number || room.open_work_order_title);
}

function hasLatestNote(room: Room): boolean {
  return Boolean(room.latest_note?.trim());
}

function isDepartureClean(room: Room): boolean {
  return room.clean_type === "DEP" || room.clean_type_label?.toLowerCase().includes("departure") === true;
}

function isFullOrLightService(room: Room): boolean {
  return room.clean_type === "FULL" || room.clean_type === "LIGHT";
}

function isGuestMayBeInside(room: Room): boolean {
  if (room.actual_checkout_at) return false;
  return room.status === "OCCUPIED" || room.fo_status === "OCC" || Boolean(room.guest_name && isDepartureClean(room));
}

export function isArrivalSoon(room: Room, now: Date = new Date()): boolean {
  const checkin = parseDate(room.checkin_time);
  if (!checkin) return false;
  const delta = checkin.getTime() - now.getTime();
  return delta >= 0 && delta <= ARRIVAL_SOON_MS;
}

export function isBlocked(room: Room): boolean {
  return BLOCKED_STATUSES.has(room.status);
}

export function isSubmitted(room: Room): boolean {
  return room.status === "CLEAN";
}

export function isReady(room: Room): boolean {
  return room.status === "INSPECTED";
}

export function isNeedsAttention(room: Room, now: Date = new Date()): boolean {
  if (isBlocked(room) || isSubmitted(room) || isReady(room)) return false;
  return Boolean(
    room.dnd_flag ||
      isGuestMayBeInside(room) ||
      (isDepartureClean(room) && !room.actual_checkout_at && room.status === "OCCUPIED") ||
      hasOpenWorkOrder(room) ||
      room.risk_level === "HIGH" ||
      hasLatestNote(room),
  );
}

export function isCleanable(room: Room, now: Date = new Date()): boolean {
  if (isBlocked(room) || isSubmitted(room) || isReady(room)) return false;
  if (room.status === "IN_PROGRESS") return !isNeedsAttention(room, now);
  if (!CLEANABLE_STATUSES.has(room.status)) return false;
  return !isNeedsAttention(room, now);
}

export function hasRoomException(room: Room, now: Date = new Date()): boolean {
  return isNeedsAttention(room, now);
}

export function getRoomQueueBucket(room: Room, now: Date = new Date()): RoomQueueBucket {
  if (isBlocked(room)) return "blocked";
  if (isReady(room)) return "ready";
  if (isSubmitted(room)) return "submitted";
  if (isNeedsAttention(room, now)) return "needs_attention";
  if (room.status === "IN_PROGRESS") return "in_progress";
  if (isCleanable(room, now)) return "next_to_clean";
  return "needs_attention";
}

function getCleaningQueueScore(room: Room, now: Date): number {
  if (room.status === "IN_PROGRESS" && !isNeedsAttention(room, now)) return 0;
  if (!isCleanable(room, now)) return 100;
  if (isDepartureClean(room) && isArrivalSoon(room, now)) return 10;
  if (room.vip_flag) return 20;
  if (isDepartureClean(room) && Boolean(room.actual_checkout_at)) return 30;
  if (room.status === "DIRTY" && !room.clean_type) return 40;
  if (isFullOrLightService(room)) return 50;
  if (room.status === "PICKUP") return 60;
  return 70;
}

export function compareRoomsForCleaningQueue(a: Room, b: Room, now: Date = new Date()): number {
  const scoreDelta = getCleaningQueueScore(a, now) - getCleaningQueueScore(b, now);
  if (scoreDelta !== 0) return scoreDelta;

  const checkoutDelta = (parseDate(a.actual_checkout_at)?.getTime() ?? 0) - (parseDate(b.actual_checkout_at)?.getTime() ?? 0);
  if (checkoutDelta !== 0) return checkoutDelta;

  const floorDelta = (a.floor ?? 0) - (b.floor ?? 0);
  if (floorDelta !== 0) return floorDelta;

  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
}

const BUCKET_ORDER: Record<RoomQueueBucket, number> = {
  next_to_clean: 0,
  needs_attention: 1,
  in_progress: 2,
  submitted: 3,
  ready: 4,
  blocked: 5,
};

export function compareRoomsByPriority(a: Room, b: Room, now: Date = new Date()): number {
  const bucketDelta = BUCKET_ORDER[getRoomQueueBucket(a, now)] - BUCKET_ORDER[getRoomQueueBucket(b, now)];
  if (bucketDelta !== 0) return bucketDelta;

  const queueDelta = compareRoomsForCleaningQueue(a, b, now);
  if (queueDelta !== 0) return queueDelta;

  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
}

export function getRoomAction(room: Room, now: Date = new Date()): RoomAction {
  if (isBlocked(room)) return { kind: "blocked", label: "Blocked", disabled: true };
  if (isReady(room)) return { kind: "ready", label: "Ready", disabled: true };
  if (isSubmitted(room)) return { kind: "submitted", label: "Waiting", allowUndo: true, disabled: true };
  if (isNeedsAttention(room, now)) return { kind: "review", label: "Review" };

  if (room.status === "IN_PROGRESS") {
    return { kind: "done", label: "Done", targetStatus: "CLEAN", allowUndo: true };
  }

  if (isCleanable(room, now)) {
    return { kind: "start", label: "Start", targetStatus: "IN_PROGRESS" };
  }

  return { kind: "view", label: "Review" };
}

export function getRoomBadges(room: Room, now: Date = new Date()): RoomBadge[] {
  const badges: RoomBadge[] = [];
  if (room.dnd_flag) badges.push({ key: "dnd", label: "DND" });
  if (room.vip_flag) badges.push({ key: "vip", label: "VIP" });
  if (hasOpenWorkOrder(room)) badges.push({ key: "work_order", label: "WO" });
  if (hasLatestNote(room)) badges.push({ key: "note", label: "Note" });
  if (room.risk_level === "HIGH") badges.push({ key: "risk", label: "Risk" });
  if (isArrivalSoon(room, now)) badges.push({ key: "arrival", label: "Arrival Soon" });
  if (isDepartureClean(room) && !room.actual_checkout_at) badges.push({ key: "checkout", label: "Not Checked Out" });
  return badges;
}

export function getPrimaryTimingLine(room: Room, now: Date = new Date()): TimingLine | null {
  const actualCheckout = formatTime(room.actual_checkout_at);
  if (actualCheckout) return { label: "Checked out", value: actualCheckout };

  const checkout = formatTime(room.checkout_time);
  if (checkout) return { label: "Due out", value: checkout };

  const checkin = formatTime(room.checkin_time);
  if (checkin && (isArrivalSoon(room, now) || isDepartureClean(room))) {
    return { label: "Arrival", value: checkin };
  }

  return null;
}

export function getPriorityScore(room: Room, now: Date = new Date()): number {
  const bucket = getRoomQueueBucket(room, now);
  return BUCKET_ORDER[bucket] * 100 + getCleaningQueueScore(room, now);
}

export function getBeforeEnterWarnings(room: Room, now: Date = new Date()): BeforeEnterWarning[] {
  const warnings: BeforeEnterWarning[] = [];

  if (room.dnd_flag) {
    warnings.push({
      key: "dnd",
      label: "DND active",
      detail: "Do not enter until front desk clears the room.",
      severity: "critical",
    });
  }
  if (isGuestMayBeInside(room)) {
    warnings.push({
      key: "occupied",
      label: "Guest may be inside",
      detail: "Confirm access before entering.",
      severity: "critical",
    });
  }
  if (hasOpenWorkOrder(room)) {
    const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
    warnings.push({
      key: "work_order",
      label: "Open work order",
      detail: `${room.open_work_order_title || "Engineering has an open item"}${number}.`,
      severity: "warning",
    });
  }
  if (room.risk_level === "HIGH") {
    warnings.push({
      key: "risk",
      label: "High risk",
      detail: "Review room context before completing.",
      severity: "warning",
    });
  }
  if (hasLatestNote(room)) {
    warnings.push({ key: "note", label: "Latest note", detail: room.latest_note!.trim(), severity: "warning" });
  }
  if (isDepartureClean(room) && isArrivalSoon(room, now)) {
    warnings.push({
      key: "arrival",
      label: "Arrival soon",
      detail: "Prioritize once the room is safe to enter.",
      severity: "info",
    });
  }
  if (room.vip_flag) {
    warnings.push({
      key: "vip",
      label: "VIP room",
      detail: "Presentation matters. Leave time for a final pass.",
      severity: "info",
    });
  }

  return warnings;
}
