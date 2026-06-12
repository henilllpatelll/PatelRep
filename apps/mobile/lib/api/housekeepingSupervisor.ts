import { api } from "@/lib/api/client";
import {
  type AssignableStaff,
  type BoardRoomRaw,
  extractAssignableStaff,
} from "@/lib/housekeeping/supervisor";

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
