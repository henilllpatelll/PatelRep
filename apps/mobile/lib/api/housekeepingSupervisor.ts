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
import type { AssignmentRemovalPlan, LateCheckoutRecord } from "@/lib/housekeeping/roomBoardModel";
import { normalizeScheduledShifts, type ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import { parseWorkloadSettings, type WorkloadSettings } from "@/lib/housekeeping/assignmentWorkload";
import { readSavedHandoff, type EndShiftSummaryPayload, type SavedHandoff } from "@/lib/housekeeping/supervisorHandoff";

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
  /**
   * Compare-and-set: the housekeeper the supervisor saw on the room, or `expect_unassigned` when they saw none.
   * The server answers 409 instead of overwriting a newer assignment or moving a room whose cleaning started.
   */
  expected_assigned_to?: string;
  expect_unassigned?: boolean;
  /**
   * The soft blocks (DND, declined service, return-later, occupancy discrepancy) the supervisor knowingly accepted.
   * When present — even empty — the SERVER recomputes the room's soft blocks and answers 409
   * `acknowledgement_required` unless every one is listed, so an acknowledgement is checked, not trusted.
   */
  acknowledged_blocks?: string[];
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

/**
 * POST /housekeeping/assignments/remove: removes ONE room's assignment only while it still belongs to
 * `expectedUserId` and the room has not started. The owner is part of the server's write, so a room that changed
 * hands in the meantime removes nothing and answers 409 (`assignment_changed` / `room_not_assignable`). Works for a
 * dated assignment and for a mirror-only one — no assignment id is needed.
 */
export async function removeAssignmentGuarded(date: string, roomId: string, expectedUserId: string): Promise<void> {
  await api.post("/housekeeping/assignments/remove", { date, room_id: roomId, expected_assigned_to: expectedUserId });
}

/**
 * DELETE /housekeeping/room-assignment/{room_id}: clears the room_status.assigned_to mirror for a room the
 * board shows as assigned WITHOUT a dated room_assignments row (so there is no assignment id to delete).
 * gm + housekeeping_supervisor only; tenant-scoped by the server.
 */
export async function removeRoomMirrorAssignment(roomId: string): Promise<void> {
  await api.delete(`/housekeeping/room-assignment/${encodeURIComponent(roomId)}`);
}

/** Runs the removal `planAssignmentRemoval` chose. A room with nothing to remove is a no-op that says so. */
export async function removeAssignmentByPlan(plan: AssignmentRemovalPlan): Promise<boolean> {
  if (plan.kind === "assignment") {
    await removeAssignment(plan.assignmentId);
    return true;
  }
  if (plan.kind === "mirror") {
    await removeRoomMirrorAssignment(plan.roomId);
    return true;
  }
  return false;
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

/** Strict variant for the Room Board: a payload that is not the documented shape THROWS (never a false "none"). */
export async function fetchLateCheckoutsVerified(): Promise<LateCheckoutRecord[]> {
  return requireArray<LateCheckoutRecord>(
    await api.get("/late-checkout/requests?status=pending&status=approved"),
    "late checkouts",
  );
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

/**
 * GET /hotels/{id}/housekeeping-settings — the property's workload credit weights, daily target and per-person
 * capacity overrides (gm + housekeeping_supervisor only). Strict: a malformed body throws.
 */
export async function fetchWorkloadSettings(hotelId: string): Promise<WorkloadSettings> {
  return parseWorkloadSettings(await api.get(`/hotels/${encodeURIComponent(hotelId)}/housekeeping-settings`));
}

/** GET /schedules/assignments?work_date= — who is scheduled on the hotel's `date`. Strict: a malformed body throws. */
export async function fetchScheduledShifts(date: string): Promise<ScheduledShift[]> {
  return normalizeScheduledShifts(await api.get(`/schedules/assignments?work_date=${date}`), date);
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

/** Inspections completed on the hotel's `date`; the server owns hotel-local DST boundaries. */
export async function fetchInspectionHistory(date: string): Promise<InspectionRecordRaw[]> {
  return requireArray<InspectionRecordRaw>(
    await api.get(`/housekeeping/inspections?date_from=${date}&date_to=${date}`),
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

/* ─── Shift handoff ─────────────────────────────────────────────────────────
   POST /housekeeping/end-shift-summary saves ONE logbook entry per `client_request_id` and tells the GMs;
   the same id again returns the same entry. GET /housekeeping/end-shift-summary/{id} reads it back without writing,
   which is how an unclear failure is resolved. Neither clocks anyone out or touches an operational record. */

/** Resolves only once the server returned a record id; anything else throws so the caller never shows "saved". */
export async function submitShiftHandoff(payload: EndShiftSummaryPayload): Promise<SavedHandoff> {
  const saved = readSavedHandoff(await api.post<unknown>("/housekeeping/end-shift-summary", payload));
  if (!saved) throw new Error("Malformed handoff response");
  return saved;
}

/** The report saved under `requestId` by the signed-in person, or null when the server has none (a definite "no"). */
export async function fetchShiftHandoff(requestId: string): Promise<SavedHandoff | null> {
  try {
    const saved = readSavedHandoff(await api.get<unknown>(`/housekeeping/end-shift-summary/${encodeURIComponent(requestId)}`));
    if (!saved) throw new Error("Malformed handoff response");
    return saved;
  } catch (error) {
    const { status, code } = (error as { status?: unknown; code?: unknown } | null) ?? {};
    if (status === 404 && code === "handoff_not_found") return null;
    throw error;
  }
}

/** One logbook entry as the report viewer needs it. */
export interface LogbookReport {
  id: string;
  content: string;
  entryDate: string | null;
  createdAt: string | null;
  authorName: string | null;
  departmentName: string | null;
}

/** GET /logbook/entries/{id}: tenant-scoped by the server; a record outside the hotel is a 404, not data. */
export async function fetchLogbookReport(entryId: string): Promise<LogbookReport> {
  const res = await api.get<{ data?: Record<string, unknown> | null }>(`/logbook/entries/${encodeURIComponent(entryId)}`);
  const row = res?.data;
  const id = typeof row?.id === "string" ? row.id : null;
  const content = typeof row?.content === "string" ? row.content : null;
  if (!row || !id || content === null) throw new Error("Malformed logbook response");
  const profile = (row.user_profiles ?? null) as { preferred_name?: unknown; full_name?: unknown } | null;
  const department = (row.departments ?? null) as { name?: unknown } | null;
  const name = profile?.preferred_name ?? profile?.full_name;
  return {
    id,
    content,
    entryDate: typeof row.entry_date === "string" ? row.entry_date : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    authorName: typeof name === "string" ? name : null,
    departmentName: typeof department?.name === "string" ? department.name : null,
  };
}
