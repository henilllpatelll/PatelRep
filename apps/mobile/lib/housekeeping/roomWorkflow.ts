import type { Room } from "@/stores/appStore";

export type RoomBadgeKey = "vip" | "dnd" | "work_order" | "note" | "risk";
export type RoomActionKind =
  | "start"
  | "review"
  | "done"
  | "review_done"
  | "submitted"
  | "ready"
  | "blocked"
  | "view";

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
}

const ACTIONABLE_STATUSES = new Set(["DIRTY", "PICKUP", "OCCUPIED"]);
const BLOCKED_STATUSES = new Set(["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);
const ARRIVAL_SOON_MS = 4 * 60 * 60 * 1000;
const MY_ROOMS_STATUS_ORDER: Partial<Record<Room["status"], number>> = {
  DIRTY: 0,
  PICKUP: 1,
  OCCUPIED: 2,
};

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
  return Boolean(room.open_work_order_id || room.open_work_order_number);
}

function hasLatestNote(room: Room): boolean {
  return Boolean(room.latest_note?.trim());
}

function isDepartureClean(room: Room): boolean {
  return room.clean_type === "DEP" || room.clean_type_label?.toLowerCase().includes("departure") === true;
}

function isDirtyLike(room: Room): boolean {
  return ACTIONABLE_STATUSES.has(room.status);
}

export function isArrivalSoon(room: Room, now: Date = new Date()): boolean {
  const checkin = parseDate(room.checkin_time);
  if (!checkin) return false;
  const delta = checkin.getTime() - now.getTime();
  return delta >= 0 && delta <= ARRIVAL_SOON_MS;
}

export function hasRoomException(room: Room, now: Date = new Date()): boolean {
  return Boolean(
    room.vip_flag ||
      room.dnd_flag ||
      hasOpenWorkOrder(room) ||
      hasLatestNote(room) ||
      room.risk_level === "HIGH" ||
      (isDepartureClean(room) && isArrivalSoon(room, now)) ||
      (isDepartureClean(room) && !room.actual_checkout_at),
  );
}

export function getRoomAction(room: Room, now: Date = new Date()): RoomAction {
  const hasException = hasRoomException(room, now);

  if (isDirtyLike(room)) {
    return hasException
      ? { kind: "review", label: "Review" }
      : { kind: "start", label: "Start", targetStatus: "IN_PROGRESS" };
  }

  if (room.status === "IN_PROGRESS") {
    return hasException
      ? { kind: "review_done", label: "Review Done" }
      : { kind: "done", label: "Done", targetStatus: "CLEAN", allowUndo: true };
  }

  if (room.status === "CLEAN") {
    return { kind: "submitted", label: "Submitted", allowUndo: true, disabled: true };
  }

  if (room.status === "INSPECTED") {
    return { kind: "ready", label: "Ready", disabled: true };
  }

  if (BLOCKED_STATUSES.has(room.status)) {
    return { kind: "blocked", label: "Blocked", disabled: true };
  }

  return { kind: "view", label: "View" };
}

export function getRoomBadges(room: Room): RoomBadge[] {
  const badges: RoomBadge[] = [];
  if (room.vip_flag) badges.push({ key: "vip", label: "VIP" });
  if (room.dnd_flag) badges.push({ key: "dnd", label: "DND" });
  if (hasOpenWorkOrder(room)) badges.push({ key: "work_order", label: "WO" });
  if (hasLatestNote(room)) badges.push({ key: "note", label: "Note" });
  if (room.risk_level === "HIGH") badges.push({ key: "risk", label: "Risk" });
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
  if (room.status === "IN_PROGRESS") return 10;

  if ((room.status === "DIRTY" || room.status === "PICKUP") && (room.vip_flag || isArrivalSoon(room, now))) {
    return 20;
  }

  if (isDepartureClean(room) && Boolean(room.actual_checkout_at) && isDirtyLike(room)) return 30;
  if (room.risk_level === "HIGH" && room.status !== "CLEAN" && room.status !== "INSPECTED") return 40;

  if (
    (room.dnd_flag || hasOpenWorkOrder(room) || hasLatestNote(room) || (isDepartureClean(room) && !room.actual_checkout_at)) &&
    room.status !== "CLEAN" &&
    room.status !== "INSPECTED"
  ) {
    return 50;
  }

  if (room.status === "DIRTY" || room.status === "OCCUPIED") return 60;
  if (room.status === "PICKUP") return 70;
  if (room.status === "CLEAN") return 80;
  if (room.status === "INSPECTED") return 90;
  if (BLOCKED_STATUSES.has(room.status)) return 100;
  return 110;
}

export function compareRoomsByPriority(a: Room, b: Room, now: Date = new Date()): number {
  const aStatusOrder = MY_ROOMS_STATUS_ORDER[a.status];
  const bStatusOrder = MY_ROOMS_STATUS_ORDER[b.status];
  if (aStatusOrder !== undefined || bStatusOrder !== undefined) {
    const orderDelta = (aStatusOrder ?? Number.MAX_SAFE_INTEGER) - (bStatusOrder ?? Number.MAX_SAFE_INTEGER);
    if (orderDelta !== 0) return orderDelta;

    const roomDelta = a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
    if (roomDelta !== 0) return roomDelta;
  }

  const scoreDelta = getPriorityScore(a, now) - getPriorityScore(b, now);
  if (scoreDelta !== 0) return scoreDelta;

  const floorDelta = (a.floor ?? 0) - (b.floor ?? 0);
  if (floorDelta !== 0) return floorDelta;

  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
}

export function getBeforeEnterWarnings(room: Room, now: Date = new Date()): BeforeEnterWarning[] {
  const warnings: BeforeEnterWarning[] = [];

  if (room.dnd_flag) {
    warnings.push({ key: "dnd", label: "DND active", detail: "Do not enter until cleared by front desk." });
  }
  if (room.vip_flag) {
    warnings.push({ key: "vip", label: "VIP room", detail: "Double-check presentation before marking clean." });
  }
  if (hasOpenWorkOrder(room)) {
    const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
    warnings.push({
      key: "work_order",
      label: "Open work order",
      detail: `${room.open_work_order_title || "Engineering has an open item"}${number}.`,
    });
  }
  if (hasLatestNote(room)) {
    warnings.push({ key: "note", label: "Latest note", detail: room.latest_note!.trim() });
  }
  if (room.risk_level === "HIGH") {
    warnings.push({ key: "risk", label: "High risk", detail: "Review room context before completing." });
  }
  if (room.status === "OCCUPIED" || (room.guest_name && !room.actual_checkout_at && isDepartureClean(room))) {
    warnings.push({ key: "occupied", label: "Guest may be inside", detail: "Confirm access before entering." });
  }
  if (isDepartureClean(room) && !room.actual_checkout_at) {
    warnings.push({ key: "checkout", label: "Not checked out", detail: "Departure clean has no actual checkout yet." });
  }
  if (isDepartureClean(room) && isArrivalSoon(room, now)) {
    warnings.push({ key: "arrival", label: "Arrival soon", detail: "Prioritize if the room is clear to clean." });
  }

  return warnings;
}
