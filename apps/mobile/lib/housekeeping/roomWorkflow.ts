import type { Room } from "@/stores/appStore";

export type RoomBadgeKey =
  | "dnd"
  | "work_order"
  | "note"
  | "risk"
  | "arrival"
  | "checkout";

export type RoomActionKind =
  | "start"
  | "review"
  | "guest_checkout"
  | "done"
  | "submitted"
  | "ready"
  | "blocked"
  | "view";

export type RoomQueueBucket =
  | "next_to_clean"
  | "needs_attention"
  | "in_progress"
  | "skipped"
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

function hasBlockingNote(room: Room): boolean {
  const note = room.latest_note?.trim();
  if (!note) return false;
  return !note.startsWith("FLAG: ");
}

function isDepartureClean(room: Room): boolean {
  return room.clean_type === "DEP" || room.clean_type_label?.toLowerCase().includes("departure") === true;
}

function isFullOrLightService(room: Room): boolean {
  return room.clean_type === "FULL" || room.clean_type === "LIGHT";
}

function isGuestMayBeInside(room: Room): boolean {
  if (room.actual_checkout_at) return false;
  if (room.status === "IN_PROGRESS") return false; // housekeeper is already inside cleaning
  return room.status === "OCCUPIED" || room.status === "PICKUP" || room.fo_status === "OCC" || Boolean(room.guest_name && isDepartureClean(room));
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

export function isSkipped(room: Room): boolean {
  if (room.dnd_flag) return true;
  // Guest declined service on a pickup (stayover) room
  if (room.do_not_service && room.status === "PICKUP") return true;
  return false;
}

export function isSubmitted(room: Room): boolean {
  return room.status === "CLEAN";
}

export function isReady(room: Room): boolean {
  return room.status === "INSPECTED";
}

export function isNeedsAttention(room: Room, now: Date = new Date()): boolean {
  if (isBlocked(room) || isSubmitted(room) || isReady(room) || isSkipped(room)) return false;
  // Vacant checked-out departure rooms: notes and work orders are informational (shown as
  // badges and before-enter warnings) — they don't block the room from the cleaning queue.
  const isVacantDeparture = isDepartureClean(room) && Boolean(room.actual_checkout_at);
  return Boolean(
    isGuestMayBeInside(room) ||
      (!isVacantDeparture && hasOpenWorkOrder(room)) ||
      room.risk_level === "HIGH" ||
      (!isVacantDeparture && hasBlockingNote(room)),
  );
}

export function isCleanable(room: Room, now: Date = new Date()): boolean {
  if (isBlocked(room) || isSubmitted(room) || isReady(room) || isSkipped(room)) return false;
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
  if (isSkipped(room)) return "skipped";
  if (isNeedsAttention(room, now)) return "needs_attention";
  if (room.status === "IN_PROGRESS") return "in_progress";
  if (isCleanable(room, now)) return "next_to_clean";
  return "needs_attention";
}

export function getCleaningQueueScore(room: Room, now: Date): number {
  if (room.status === "IN_PROGRESS" && !isNeedsAttention(room, now)) return 0;
  if (!isCleanable(room, now)) return 100;
  if (isDepartureClean(room) && isArrivalSoon(room, now)) return 10;
  if (isDepartureClean(room)) return 20;
  if (room.status === "DIRTY" && !room.clean_type) return 30;
  if (isFullOrLightService(room) || room.status === "PICKUP") return 40;
  return 50;
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
  skipped: 3,
  submitted: 4,
  ready: 5,
  blocked: 6,
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
  if (isSkipped(room)) return { kind: "view", label: "DND", disabled: true };
  if (room.status === "OCCUPIED" && isDepartureClean(room)) {
    return { kind: "guest_checkout", label: "Review", targetStatus: "IN_PROGRESS" };
  }
  // IN_PROGRESS must come before isNeedsAttention: once a housekeeper has started
  // cleaning, stale flags (fo_status OCC, notes, WOs) should not hide the "done" button.
  if (room.status === "IN_PROGRESS") {
    return { kind: "done", label: "Done", targetStatus: "CLEAN", allowUndo: true };
  }
  if (isNeedsAttention(room, now)) {
    return { kind: "review", label: "Review", targetStatus: "IN_PROGRESS" };
  }

  if (isCleanable(room, now)) {
    if (hasOpenWorkOrder(room) || hasLatestNote(room)) {
      return { kind: "review", label: "Review", targetStatus: "IN_PROGRESS" };
    }
    return { kind: "start", label: "Start", targetStatus: "IN_PROGRESS" };
  }

  return { kind: "view", label: "Review" };
}

export function getRoomBadges(room: Room, now: Date = new Date()): RoomBadge[] {
  const badges: RoomBadge[] = [];
  if (room.dnd_flag) badges.push({ key: "dnd", label: "DND" });
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

export function hasRoomInProgress(rooms: Room[], excludeRoomId: string): boolean {
  return rooms.some((r) => r.id !== excludeRoomId && r.status === "IN_PROGRESS");
}

// ─── Floor-grouped routing (My Rooms view) ────────────────────────────────────

export type Building = "A" | "B" | "unknown";

export interface BuildingFloorGroup {
  floor: number;
  rooms: Room[];
}

export interface BuildingGroup {
  building: Building;
  floors: BuildingFloorGroup[];
}

/** True when the housekeeper actively cannot enter: DND active, service declined,
 *  or a BLOCKER note on the room (Guest inside / Can't enter / DND on door tap). */
export function isFloorException(room: Room): boolean {
  if (room.dnd_flag) return true;
  if (room.do_not_service) return true;
  const note = room.latest_note?.trim();
  return Boolean(note && note.startsWith("BLOCKER: "));
}

const REMAINING_STATUSES = new Set<Room["status"]>(["DIRTY", "PICKUP", "OCCUPIED", "IN_PROGRESS"]);

/** Derives building from room suffix (01–16 = A west wing, 17–39 = B east wing). */
function getBuildingFromRoomNumber(roomNumber: string): Building {
  const suffix = parseInt(roomNumber, 10) % 100;
  if (suffix >= 1 && suffix <= 16) return "A";
  if (suffix >= 17 && suffix <= 39) return "B";
  return "unknown";
}

const BUILDING_ORDER: Record<Building, number> = { A: 0, B: 1, unknown: 2 };

function withinFloorScore(room: Room): number {
  const exceptionOffset = isFloorException(room) ? 10 : 0;
  if (room.status === "IN_PROGRESS") return exceptionOffset + 0;
  if (room.status === "DIRTY") return exceptionOffset + 1;
  if (room.status === "PICKUP") return exceptionOffset + 2;
  if (room.status === "OCCUPIED") return exceptionOffset + 3;
  return exceptionOffset + 4;
}

function compareWithinFloor(a: Room, b: Room): number {
  const scoreDelta = withinFloorScore(a) - withinFloorScore(b);
  if (scoreDelta !== 0) return scoreDelta;
  // Room-number ascending = zigzag corridor order for A, north-arm-first for B
  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" });
}

/** Groups remaining rooms by building (A west → B east), then by floor within
 *  each building. Within each floor: IN_PROGRESS first, Dirty → Pickup → Occupied
 *  by room number (zigzag for A, north-arm-first for B). Exception rooms (DND /
 *  blocker / declined service) sink to the bottom of their floor group. */
export function buildBuildingGroups(rooms: Room[]): BuildingGroup[] {
  const byBuilding = new Map<Building, Map<number, Room[]>>();

  for (const room of rooms) {
    if (!REMAINING_STATUSES.has(room.status)) continue;
    const building = getBuildingFromRoomNumber(room.room_number);
    const floor = room.floor ?? 0;
    if (!byBuilding.has(building)) byBuilding.set(building, new Map());
    const floorMap = byBuilding.get(building)!;
    if (!floorMap.has(floor)) floorMap.set(floor, []);
    floorMap.get(floor)!.push(room);
  }

  const groups: BuildingGroup[] = [];
  for (const [building, floorMap] of byBuilding) {
    const floors: BuildingFloorGroup[] = [];
    for (const [floor, floorRooms] of floorMap) {
      floors.push({ floor, rooms: floorRooms.sort(compareWithinFloor) });
    }
    groups.push({ building, floors: floors.sort((a, b) => a.floor - b.floor) });
  }
  return groups.sort((a, b) => BUILDING_ORDER[a.building] - BUILDING_ORDER[b.building]);
}

// ─── Checklist constants ───────────────────────────────────────────────────────

export const LOST_FOUND_CHECK_KEY = "rooms.detail.checklist.lostFoundCheck";

export const DEPARTURE_CHECKLIST: readonly string[] = [
  "rooms.detail.checklist.lostFoundCheck",
  "rooms.detail.checklist.stripAllLinens",
  "rooms.detail.checklist.freshLinens",
  "rooms.detail.checklist.replaceAllTowels",
  "rooms.detail.checklist.cleanBathroomDep",
  "rooms.detail.checklist.restockToiletries",
  "rooms.detail.checklist.wipeMirrors",
  "rooms.detail.checklist.emptyTrashDep",
  "rooms.detail.checklist.dustSurfaces",
  "rooms.detail.checklist.wipeTvRemote",
  "rooms.detail.checklist.resetTv",
  "rooms.detail.checklist.checkSafe",
  "rooms.detail.checklist.checkAc",
  "rooms.detail.checklist.restockMinibar",
  "rooms.detail.checklist.vacuumDep",
  "rooms.detail.checklist.mopHardFloor",
  "rooms.detail.checklist.cleanDoorHandles",
  "rooms.detail.checklist.restockStationery",
  "rooms.detail.checklist.finalSweepDep",
  "rooms.detail.checklist.markCleanItem",
] as const;

export const STAYOVER_CHECKLIST: readonly string[] = [
  "rooms.detail.checklist.makeBedPickup",
  "rooms.detail.checklist.replaceTowelsUsed",
  "rooms.detail.checklist.cleanToiletSink",
  "rooms.detail.checklist.restockToiletriesNeeded",
  "rooms.detail.checklist.emptyTrashPickup",
  "rooms.detail.checklist.dustSurfacesQuick",
  "rooms.detail.checklist.vacuumIfNeeded",
  "rooms.detail.checklist.tidyDesk",
  "rooms.detail.checklist.finalVisualCheck",
  "rooms.detail.checklist.markCleanPickup",
] as const;

export function getChecklistForRoom(room: Room): readonly string[] {
  return room.clean_type === "DEP" ? DEPARTURE_CHECKLIST : STAYOVER_CHECKLIST;
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
  const notCheckedOut = isDepartureClean(room) && !room.actual_checkout_at && room.status === "OCCUPIED";
  if (notCheckedOut) {
    warnings.push({
      key: "checkout",
      label: "Not checked out",
      detail: "Guest has not officially checked out. Knock and confirm before entering.",
      severity: "critical",
    });
  } else if (isGuestMayBeInside(room)) {
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

  return warnings;
}
