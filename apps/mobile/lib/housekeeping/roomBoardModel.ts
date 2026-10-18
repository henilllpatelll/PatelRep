import {
  normalizeBoardRooms,
  type BoardRoomRaw,
  type FloorRoom,
} from "@/lib/housekeeping/supervisor";

/* ─── Room Board — canonical domain model ───────────────────────────────────
   ONE normaliser behind both Supervisor Today and the Room Board: GET /housekeeping/board rows become
   `BoardRoom`s, a `FloorRoom` (what every existing supervisor surface already consumes) plus the extra
   facts the redesigned board needs. Nothing here invents data: a field the backend did not send is
   `null` / `"unknown"`, never a default that reads as a fact.

   ROOM STATUS (GET /housekeeping/board `status`)
     DIRTY        vacant dirty — cleaning required
     OCCUPIED     occupied dirty — housekeeping required
     PICKUP       pickup / stayover cleaning
     IN_PROGRESS  being cleaned right now
     CLEAN        housekeeping SUBMITTED — awaiting inspection. NEVER guest-ready.
     INSPECTED    inspected and guest-ready — the only guest-ready status
     OOO | OUT_OF_ORDER | OUT_OF_SERVICE   unavailable; the three spellings are kept distinct
     anything else  `unknown` — kept and counted, never folded into another stage */

/* ─── Status ──────────────────────────────────────────────────────────────── */

export type RoomStatusCode =
  | "DIRTY"
  | "OCCUPIED"
  | "PICKUP"
  | "IN_PROGRESS"
  | "CLEAN"
  | "INSPECTED"
  | "OOO"
  | "OUT_OF_ORDER"
  | "OUT_OF_SERVICE";

/** Where a room is in the day, independent of how the backend spells it. */
export type RoomStage = "to_clean" | "in_progress" | "awaiting_inspection" | "guest_ready" | "unavailable" | "unknown";

export interface RoomStatusInfo {
  /** The status exactly as the backend sent it ("" when absent). */
  raw: string;
  /** The recognised code, or null for an unrecognised status. */
  code: RoomStatusCode | null;
  stage: RoomStage;
  /** True ONLY for INSPECTED. CLEAN is submitted-awaiting-inspection, not guest-ready. */
  guestReady: boolean;
  /** Which unavailable spelling the backend used, so OOO / out of order / out of service stay distinguishable. */
  unavailable: "OOO" | "OUT_OF_ORDER" | "OUT_OF_SERVICE" | null;
}

const STAGE_BY_CODE: Record<RoomStatusCode, RoomStage> = {
  DIRTY: "to_clean",
  OCCUPIED: "to_clean",
  PICKUP: "to_clean",
  IN_PROGRESS: "in_progress",
  CLEAN: "awaiting_inspection",
  INSPECTED: "guest_ready",
  OOO: "unavailable",
  OUT_OF_ORDER: "unavailable",
  OUT_OF_SERVICE: "unavailable",
};

function isStatusCode(value: string): value is RoomStatusCode {
  return Object.prototype.hasOwnProperty.call(STAGE_BY_CODE, value);
}

export function classifyRoomStatus(status: unknown): RoomStatusInfo {
  const raw = typeof status === "string" ? status : "";
  const code = isStatusCode(raw) ? raw : null;
  return {
    raw,
    code,
    stage: code ? STAGE_BY_CODE[code] : "unknown",
    guestReady: code === "INSPECTED",
    unavailable: code === "OOO" || code === "OUT_OF_ORDER" || code === "OUT_OF_SERVICE" ? code : null,
  };
}

/** i18n key for a status's plain-language meaning (an unrecognised status gets the generic "unknown" label). */
export function statusLabelKey(info: RoomStatusInfo): string {
  return `roomBoard.statusMeaning.${info.code ?? "UNKNOWN"}`;
}

/* ─── Record parts ────────────────────────────────────────────────────────── */

export type RoomOccupancy = "occupied" | "vacant" | "unknown";

/**
 * How the room is tied to a person:
 *  - `dated`         a room_assignments row exists for the board's date (assignmentId is set)
 *  - `status_mirror` only room_status.assigned_to says so (no dated row — a stale mirror, an import path).
 *                    Removing it goes through DELETE /housekeeping/room-assignment/{room_id}.
 *  - `none`          nobody
 * This is ONLY "who". Whether their name is known and whether they are on shift are separate questions
 * answered by the board composition, never inferred here.
 */
export interface BoardAssignment {
  source: "dated" | "status_mirror" | "none";
  userId: string | null;
  assignmentId: string | null;
  assignmentDate: string | null;
  shiftId: string | null;
}

export interface BoardWorkOrder {
  id: string | null;
  number: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
}

/** Compact evidence from the latest completed clean session of the board's day. */
export interface BoardCleanSession {
  sessionId: string;
  minutes: number | null;
  baseMinutes: number | null;
  checklistDone: number;
  checklistTotal: number;
  photoCount: number;
  endedAt: string | null;
}

/** The stored readiness prediction, verbatim. It is a forecast: nothing downstream may treat it as accurate. */
export interface BoardPrediction {
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  predictedReadyAt: string | null;
  /** 0..1 or null; below 0.5 the model itself calls the forecast uncertain. */
  confidence: number | null;
  calculatedAt: string | null;
}

export interface BoardServiceDeclined {
  declined: boolean;
  reason: string | null;
  note: string | null;
  at: string | null;
}

/** An open late-checkout request joined from GET /late-checkout/requests (not part of the board payload). */
export interface BoardLateCheckout {
  requestId: string;
  status: "pending" | "approved";
  requestedTime: string | null;
}

export interface BoardRoom extends FloorRoom {
  building: string | null;
  /** False when the backend sent no floor; `floor` is then the legacy 0 and must not be shown as a real floor. */
  floorKnown: boolean;
  statusInfo: RoomStatusInfo;
  occupancy: RoomOccupancy;
  assignment: BoardAssignment;
  serviceDeclined: BoardServiceDeclined;
  /** 1 (highest) .. 10 (lowest); null when not sent. The schema default is DEFAULT_ROOM_PRIORITY. */
  priority: number | null;
  /** null = the backend did not say (not "no"). */
  inspectionRequired: boolean | null;
  lastInspectedAt: string | null;
  recleanRequestedAt: string | null;
  actualCheckoutAt: string | null;
  latestNoteAt: string | null;
  workOrder: BoardWorkOrder | null;
  cleanSession: BoardCleanSession | null;
  prediction: BoardPrediction | null;
  occupancyDiscrepancy: boolean;
  /** room_status.updated_at — when the record last changed (not when this app last verified it). */
  updatedAt: string | null;
  /** Filled by the composition from the late-checkout source; null = none known. */
  lateCheckout: BoardLateCheckout | null;
}

/** The schema's default room priority; only a number BELOW it is an elevated priority. */
export const DEFAULT_ROOM_PRIORITY = 5;

/* ─── Normalisation ───────────────────────────────────────────────────────── */

export interface BoardSnapshot {
  rooms: BoardRoom[];
  /** Raw rows dropped because they had no room id or room number. */
  invalidRows: number;
  /** Raw rows dropped because the same room id appeared twice (first one wins). */
  duplicateRows: number;
  /** The hotel date the board was requested for. Absent only for snapshots built outside the loader. */
  forDate?: string;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function occupancyOf(value: unknown): RoomOccupancy {
  return value === "OCC" ? "occupied" : value === "VAC" ? "vacant" : "unknown";
}

function riskOf(value: unknown): BoardPrediction["riskLevel"] {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : null;
}

function predictionOf(raw: BoardRoomRaw["prediction"]): BoardPrediction | null {
  if (!raw || typeof raw !== "object") return null;
  const confidence = finite(raw.confidence_score);
  return {
    riskLevel: riskOf(raw.risk_level),
    predictedReadyAt: text(raw.predicted_ready_at),
    confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
    calculatedAt: text(raw.last_calculated_at),
  };
}

function assignmentOf(raw: BoardRoomRaw): BoardAssignment {
  const userId = text(raw.assigned_to);
  const assignmentId = text(raw.assignment_id);
  return {
    source: assignmentId ? "dated" : userId ? "status_mirror" : "none",
    userId,
    assignmentId,
    assignmentDate: text(raw.assignment_date),
    shiftId: text(raw.assignment_shift_id),
  };
}

function workOrderOf(raw: BoardRoomRaw): BoardWorkOrder | null {
  const id = text(raw.open_work_order_id);
  const number = text(raw.open_work_order_number);
  const title = text(raw.open_work_order_title);
  if (!id && !number && !title) return null;
  return { id, number, title, status: text(raw.open_work_order_status), priority: text(raw.open_work_order_priority) };
}

function cleanSessionOf(raw: BoardRoomRaw): BoardCleanSession | null {
  const sessionId = text(raw.last_session_id);
  if (!sessionId) return null;
  return {
    sessionId,
    minutes: finite(raw.last_clean_minutes),
    baseMinutes: finite(raw.last_clean_base_minutes),
    checklistDone: count(raw.last_clean_checklist_done),
    checklistTotal: count(raw.last_clean_checklist_total),
    photoCount: count(raw.last_clean_photo_count),
    endedAt: text(raw.last_clean_ended_at),
  };
}

/** A row can be used only if it names a room and gives it a number. Same rule as `normalizeBoardRooms`. */
function isUsableRow(row: unknown): row is BoardRoomRaw {
  if (!row || typeof row !== "object") return false;
  const raw = row as BoardRoomRaw;
  return Boolean(text(raw.room_id) && text(raw.rooms?.room_number));
}

/** One usable raw row → a `BoardRoom`. The shared fields come from the existing `normalizeBoardRooms`. */
function toBoardRoom(raw: BoardRoomRaw): BoardRoom | null {
  const [base] = normalizeBoardRooms([raw]);
  if (!base) return null;
  const statusInfo = classifyRoomStatus(raw.status);
  const occupancy = occupancyOf(raw.fo_status);
  const priority = finite(raw.priority);
  const floorKnown = typeof raw.rooms?.floor === "number" && Number.isFinite(raw.rooms.floor);
  return {
    ...base,
    status: statusInfo.raw,
    foStatus: occupancy === "occupied" ? "OCC" : occupancy === "vacant" ? "VAC" : null,
    floor: floorKnown ? (raw.rooms?.floor as number) : 0,
    floorKnown,
    building: text(raw.rooms?.building),
    statusInfo,
    occupancy,
    assignment: assignmentOf(raw),
    serviceDeclined: {
      declined: raw.do_not_service === true,
      reason: text(raw.service_declined_reason),
      note: text(raw.service_declined_note),
      at: text(raw.service_declined_at),
    },
    priority: priority === null ? null : Math.min(10, Math.max(1, Math.round(priority))),
    inspectionRequired: typeof raw.inspection_required === "boolean" ? raw.inspection_required : null,
    lastInspectedAt: text(raw.last_inspected_at),
    recleanRequestedAt: text(raw.reclean_requested_at),
    actualCheckoutAt: text(raw.actual_checkout_at),
    latestNoteAt: text(raw.latest_note_at),
    workOrder: workOrderOf(raw),
    cleanSession: cleanSessionOf(raw),
    prediction: predictionOf(raw.prediction),
    occupancyDiscrepancy: raw.occupancy_discrepancy === true,
    updatedAt: text(raw.updated_at),
    lateCheckout: null,
  };
}

/**
 * Board rows → rooms, dropping rows that cannot be tied to a room and de-duplicating by room id (first wins).
 * `forDate` stamps the snapshot with the hotel date it was requested for so a later reader can refuse it
 * once the hotel's day has moved on.
 */
export function normalizeBoardRecords(raw: unknown, forDate?: string): BoardSnapshot {
  const rows: unknown[] = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const rooms: BoardRoom[] = [];
  let invalidRows = 0;
  let duplicateRows = 0;
  for (const row of rows) {
    if (!isUsableRow(row)) {
      invalidRows += 1;
      continue;
    }
    const id = text(row.room_id) as string;
    if (seen.has(id)) {
      duplicateRows += 1;
      continue;
    }
    const room = toBoardRoom(row);
    if (!room) {
      invalidRows += 1;
      continue;
    }
    seen.add(id);
    rooms.push(room);
  }
  return { rooms, invalidRows, duplicateRows, ...(forDate ? { forDate } : {}) };
}

/* ─── Late checkout ───────────────────────────────────────────────────────── */

export interface LateCheckoutRecord {
  id: string;
  room_id: string;
  status: string;
  requested_time: string | null;
}

/** Joins open late-checkout requests onto rooms. Approved beats pending; denied or unknown statuses are ignored. */
export function attachLateCheckouts(rooms: BoardRoom[], requests: LateCheckoutRecord[] | null): BoardRoom[] {
  if (!requests || requests.length === 0) return rooms;
  const byRoom = new Map<string, BoardLateCheckout>();
  for (const request of requests) {
    if (request.status !== "pending" && request.status !== "approved") continue;
    const current = byRoom.get(request.room_id);
    if (current?.status === "approved") continue;
    if (current && request.status !== "approved") continue;
    byRoom.set(request.room_id, { requestId: request.id, status: request.status, requestedTime: request.requested_time ?? null });
  }
  if (byRoom.size === 0) return rooms;
  return rooms.map((room) => {
    const lateCheckout = byRoom.get(room.roomId);
    return lateCheckout ? { ...room, lateCheckout } : room;
  });
}

/* ─── Removing an assignment ──────────────────────────────────────────────── */

export type AssignmentRemovalPlan =
  | { kind: "assignment"; assignmentId: string }
  | { kind: "mirror"; roomId: string }
  | { kind: "none" };

/**
 * Which existing authorised endpoint removes this room's assignment:
 *  - a dated row            → DELETE /housekeeping/assignments/{assignment_id}
 *  - a status mirror alone  → DELETE /housekeeping/room-assignment/{room_id}
 * Nothing is removed by normalisation; the caller runs the plan when the supervisor confirms.
 */
export function planAssignmentRemoval(room: Pick<BoardRoom, "roomId" | "assignment">): AssignmentRemovalPlan {
  if (room.assignment.source === "dated" && room.assignment.assignmentId) {
    return { kind: "assignment", assignmentId: room.assignment.assignmentId };
  }
  if (room.assignment.source === "status_mirror") return { kind: "mirror", roomId: room.roomId };
  return { kind: "none" };
}
