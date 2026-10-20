import { api } from "@/lib/api/client";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { HistoryRowLike } from "@/lib/housekeeping/roomNote";

/* ─── Room Board drawers — the existing endpoints, typed ─────────────────────
   Nothing here is new on the server except the two corrections to the welfare-check and inspection endpoints.
   Every call is authenticated and scoped to the signed-in hotel BY THE SERVER; no tenant id is ever sent. A path
   segment is always encoded. Signed photo URLs arrive inside `fetchCleanSessionDetail` and are never logged. */

const enc = encodeURIComponent;

/* Notes + activity */

export interface RoomHistoryRow extends HistoryRowLike {
  id?: string | null;
  actor_name?: string | null;
}

/** GET /rooms/{id}/history — status changes and note-only entries since the current stay began (max 50). */
export async function fetchRoomHistory(roomId: string): Promise<RoomHistoryRow[]> {
  const res = await api.get<{ data: RoomHistoryRow[] | null }>(`/rooms/${enc(roomId)}/history?limit=50`);
  return res.data ?? [];
}

/** POST /rooms/{id}/notes — never changes the room's status. `replayed` = the server already had this exact note. */
export async function postRoomNote(roomId: string, text: string): Promise<{ replayed: boolean }> {
  const res = await api.post<{ data?: { replayed?: boolean } | null }>(`/rooms/${enc(roomId)}/notes`, { text });
  return { replayed: res?.data?.replayed === true };
}

/* Cleaning history */

export interface CleanSessionRaw {
  id: string;
  room_id?: string | null;
  housekeeper_id?: string | null;
  clean_type?: string | null;
  duration_seconds?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  status?: string | null;
  checklist_done?: number | null;
  checklist_total?: number | null;
  notes?: string | null;
}

export interface CleanSessionPhotoRaw {
  id: string;
  kind?: string | null;
  /** A short-lived signed link, or empty when it could not be signed. Never stored, never logged. */
  url?: string | null;
  created_at?: string | null;
}

export interface CleanChecklistItemRaw {
  item_id?: string | null;
  section?: string | null;
  label?: string | null;
  is_required?: boolean | null;
  checked?: boolean | null;
}

export interface CleanSessionDetailRaw extends CleanSessionRaw {
  checklist?: CleanChecklistItemRaw[] | null;
  photos?: CleanSessionPhotoRaw[] | null;
}

/** The server's ceiling for one list request; there is no offset, so this is also the history's bound. */
export const CLEAN_SESSION_FETCH_LIMIT = 50;

/** GET /clean-sessions?room_id= — newest first, this hotel only. */
export async function fetchCleanSessions(roomId: string): Promise<CleanSessionRaw[]> {
  const res = await api.get<{ data: CleanSessionRaw[] | null }>(`/clean-sessions?room_id=${enc(roomId)}&limit=${CLEAN_SESSION_FETCH_LIMIT}`);
  return res.data ?? [];
}

/** GET /clean-sessions/{id} — supervisors and the GM may read any session of their own hotel. */
export async function fetchCleanSessionDetail(sessionId: string): Promise<CleanSessionDetailRaw> {
  const res = await api.get<{ data: CleanSessionDetailRaw }>(`/clean-sessions/${enc(sessionId)}`);
  return res.data;
}

/* Inspections */

export interface RoomInspectionRaw {
  id: string;
  room_number?: string | null;
  inspector_name?: string | null;
  overall_result?: string | null;
  notes?: string | null;
  completed_at?: string | null;
}

/** GET /housekeeping/inspections for ONE room over hotel-local calendar days (the server resolves the zone). */
export async function fetchRoomInspections(roomId: string, from: string, to: string): Promise<RoomInspectionRaw[]> {
  const res = await api.get<{ data: RoomInspectionRaw[] | null }>(
    `/housekeeping/inspections?room_id=${enc(roomId)}&date_from=${enc(from)}&date_to=${enc(to)}`,
  );
  return res.data ?? [];
}

/* Work order */

/** GET /work-orders/{id} — read-only here; tenant-scoped by the server. */
export async function fetchWorkOrderDetail(workOrderId: string): Promise<WorkOrder> {
  const res = await api.get<{ data: WorkOrder }>(`/work-orders/${enc(workOrderId)}`);
  return res.data;
}

/* Wellness check */

export interface WelfareCheckResult {
  taskId: string | null;
  /** True when an open request for this room already existed — nothing new was created or sent. */
  alreadyRequested: boolean;
}

/** POST /rooms/{id}/welfare-check — the one wellness-check path. Needs DND on; idempotent while a request is open. */
export async function requestWelfareCheck(roomId: string): Promise<WelfareCheckResult> {
  const res = await api.post<{ data?: { task_id?: string | null; already_requested?: boolean } | null }>(
    `/rooms/${enc(roomId)}/welfare-check`,
    {},
  );
  return { taskId: res?.data?.task_id ?? null, alreadyRequested: res?.data?.already_requested === true };
}
