import { api } from "@/lib/api/client";
import type { WorkOrderPriority, WorkOrderStatus } from "@/lib/engineering/workOrders";

/* Chief-engineer team endpoints (apps/api/routers/engineering_team.py + POST /work-orders/{id}/assign).
   The server computes every count and decides every permission; nothing here guesses. */

export type AttentionKind = "emergency_unassigned" | "urgent_overdue" | "escalated" | "on_hold";

export interface TeamCounts {
  open: number;
  overdue: number;
  on_hold: number;
  emergency: number;
  unassigned: number;
  /** Unassigned and open/escalated: exactly what the Available view lists. Absent from an older server (= unknown). */
  needs_owner?: number;
  /** Assigned and in progress. Absent from an older server (= unknown). */
  in_progress?: number;
  /** null = the server could not read PM schedules (unknown, never "zero"). */
  pm_overdue: number | null;
}

export interface Technician {
  user_id: string;
  name: string | null;
  /** Assigned and not on hold. */
  active: number;
  urgent: number;
  on_hold: number;
  overdue: number;
}

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  work_order_number: string | number | null;
  title: string | null;
  priority: WorkOrderPriority | null;
  status: WorkOrderStatus | null;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  due_at: string | null;
  room_id: string | null;
  room_number: string | null;
  hold_reason_code?: string | null;
  hold_reason_note?: string | null;
  held_since?: string | null;
}

export interface PmOversight {
  /** The oldest overdue inspections (a few), and how many are overdue in all. */
  overdue: { id: string; name: string | null; asset_name: string | null; next_due_at: string | null }[];
  overdue_total: number;
  /** Equipment whose recent inspections recorded defects at least twice. */
  repeat_defects: { asset_id: string; asset_name: string | null; count: number }[];
  repeat_window_days: number;
}

export interface TeamOverview {
  generated_at: string;
  counts: TeamCounts;
  /** null = unknown. */
  rooms_down: { total: number; past_expected_return: number } | null;
  /** null = the server could not read the PM tables (unknown, never "all clear"). */
  pm_oversight: PmOversight | null;
  technicians: Technician[];
  attention_counts: Record<AttentionKind, number>;
  needs_attention: AttentionItem[];
  /** More active orders exist than the server read; counts are a floor. */
  truncated: boolean;
}

export async function fetchTeamOverview(signal?: AbortSignal): Promise<TeamOverview> {
  const res = await api.get<{ data: TeamOverview }>("/engineering/team/overview", { signal });
  return res.data;
}

export async function fetchTechnicians(signal?: AbortSignal): Promise<Technician[]> {
  const res = await api.get<{ data: { technicians: Technician[] } }>("/engineering/team/technicians", { signal });
  return res.data.technicians ?? [];
}

export interface AssignInput {
  workOrderId: string;
  assignedTo: string;
  /** The assignee the caller was looking at; null = it saw the order unassigned. */
  expectedAssignedTo: string | null;
  note?: string;
}

export interface AssignResult {
  /** false = it was already assigned to that person; nothing was written. */
  changed: boolean;
  assignedTo: string | null;
}

export async function assignWorkOrder(input: AssignInput): Promise<AssignResult> {
  const res = await api.post<{ data: { changed?: boolean; assigned_to?: string | null } }>(`/work-orders/${input.workOrderId}/assign`, {
    assigned_to: input.assignedTo,
    expected_assigned_to: input.expectedAssignedTo,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  });
  return { changed: res.data?.changed !== false, assignedTo: res.data?.assigned_to ?? input.assignedTo };
}
