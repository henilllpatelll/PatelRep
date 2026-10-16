import { api } from "@/lib/api/client";
import {
  type AssignableStaff,
  type BoardRoomRaw,
  extractAssignableStaff,
} from "@/lib/housekeeping/supervisor";
import {
  type BroadcastOutcome,
  type DepartmentRow,
  TEAM_MESSAGE_ROLES,
  buildShiftNotePayload,
  readBroadcastResult,
} from "@/lib/housekeeping/supervisorComms";

/* ─── Supervisor housekeeping API ───────────────────────────────────────────
   Typed wrappers around the real endpoint contracts. Assignment saves use
   the CreateAssignmentsRequest shape `{ date, assignments: [{ room_id,
   housekeeper_id }], is_ai_suggested }` — NOT per-room `assigned_to`. */

export async function fetchBoard(date: string): Promise<BoardRoomRaw[]> {
  const res = await api.get<{ data: BoardRoomRaw[] }>(`/housekeeping/board?date=${date}`);
  return res.data ?? [];
}

export async function fetchAssignableStaff(): Promise<AssignableStaff[]> {
  const res = await api.get<unknown>("/staff");
  return extractAssignableStaff(res);
}

export interface AssignmentInput {
  room_id: string;
  housekeeper_id: string;
}

export async function saveAssignments(
  date: string,
  assignments: AssignmentInput[],
  isAiSuggested = false,
): Promise<void> {
  await api.post("/housekeeping/assignments", {
    date,
    shift_id: null,
    assignments,
    is_ai_suggested: isAiSuggested,
  });
}

export async function removeAssignment(assignmentId: string): Promise<void> {
  await api.delete(`/housekeeping/assignments/${assignmentId}`);
}

/* ─── AI workload balancing (suggest → review → commit) ───────────────────── */

export interface SuggestedRoom {
  room_id: string;
  room_number: string;
  status: string;
  room_type: string;
  base_clean_minutes: number;
  is_vip: boolean;
}

export interface AssignmentSuggestion {
  housekeeper: { id: string; full_name: string; preferred_name: string };
  rooms: SuggestedRoom[];
  room_count: number;
  total_minutes: number;
}

export interface SuggestAssignmentsResult {
  suggestions: AssignmentSuggestion[];
  message: string;
}

export async function suggestAssignments(date: string): Promise<SuggestAssignmentsResult> {
  const res = await api.post<{ data: SuggestAssignmentsResult }>(
    `/housekeeping/ai-suggest-assignments?date=${date}`,
    {},
  );
  return res.data;
}

/* ─── Late checkout requests ───────────────────────────────────────────────── */

export interface LateCheckoutRequest {
  id: string;
  room_id: string;
  status: "pending" | "approved" | "denied";
  requested_time: string | null;
}

export async function fetchLateCheckouts(): Promise<LateCheckoutRequest[]> {
  const res = await api.get<{ data: LateCheckoutRequest[] }>(
    "/late-checkout/requests?status=pending&status=approved",
  );
  return res.data ?? [];
}

/* ─── Re-clean after failed inspection ────────────────────────────────────── */

export async function triggerReclean(inspectionId: string): Promise<void> {
  await api.post(`/housekeeping/inspections/${inspectionId}/reclean`, {});
}

/* ─── Supervisor Today reads ────────────────────────────────────────────────
   Strict variants: a payload that is not the documented shape THROWS instead of
   becoming an empty list, so the Today layer reports "failed", never a false zero. */

function requireArray<T>(payload: { data?: unknown } | null | undefined, what: string): T[] {
  if (!payload || !Array.isArray(payload.data)) throw new Error(`Malformed ${what} response`);
  return payload.data as T[];
}

/** GET /housekeeping/board — every room of the hotel with today's assignment merged in. */
export async function fetchBoardVerified(date: string): Promise<BoardRoomRaw[]> {
  return requireArray<BoardRoomRaw>(await api.get(`/housekeeping/board?date=${date}`), "board");
}

/** One row of GET /shifts/roster: the latest hk_shift_sessions row per person that started in the day. */
export interface ShiftRosterRowRaw {
  user_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  on_break_since?: string | null;
  break_seconds?: number | null;
}

/** GET /shifts/roster — gm + housekeeping_supervisor only (403 otherwise). */
export async function fetchShiftRoster(date: string): Promise<ShiftRosterRowRaw[]> {
  return requireArray<ShiftRosterRowRaw>(await api.get(`/shifts/roster?date=${date}`), "roster");
}

/** One row of GET /housekeeping/inspections (flattened by the server). */
export interface InspectionRecordRaw {
  id?: string | null;
  room_number?: string | null;
  inspector_name?: string | null;
  overall_result?: string | null;
  notes?: string | null;
  completed_at?: string | null;
}

/** Inspections completed on the hotel's `date`; `tzOffset` is JS getTimezoneOffset() minutes for that zone. */
export async function fetchInspectionHistory(date: string, tzOffset: number): Promise<InspectionRecordRaw[]> {
  return requireArray<InspectionRecordRaw>(
    await api.get(`/housekeeping/inspections?date_from=${date}&date_to=${date}&tz_offset=${tzOffset}`),
    "inspections",
  );
}

/* ─── Direct message to one housekeeper ───────────────────────────────────── */

export async function sendDirectMessage(
  recipientId: string,
  message: string,
): Promise<void> {
  await api.post("/notifications/direct", { recipient_id: recipientId, message: message.trim() });
}

/* ─── Shift note & team message ─────────────────────────────────────────────
   A note is a logbook entry (POST /logbook/entries needs a real department_id); a team
   message is an inbox broadcast (POST /notifications/broadcast) — never a task. */

/** GET /hotels/{id}/departments — the hotel's own departments (id, name, code). */
export async function fetchHotelDepartments(hotelId: string): Promise<DepartmentRow[]> {
  return requireArray<DepartmentRow>(await api.get(`/hotels/${encodeURIComponent(hotelId)}/departments`), "departments");
}

/** POST /logbook/entries. Resolves only once the server has stored the entry. */
export async function createShiftNote(departmentId: string, content: string): Promise<void> {
  await api.post("/logbook/entries", buildShiftNotePayload(departmentId, content));
}

/** POST /notifications/broadcast to housekeeper accounts. Returns what the server reported, unmodified. */
export async function sendTeamBroadcast(message: string, roles: readonly string[] = TEAM_MESSAGE_ROLES): Promise<BroadcastOutcome> {
  const response = await api.post<unknown>("/notifications/broadcast", { message: message.trim(), roles: [...roles] });
  return readBroadcastResult(response);
}
