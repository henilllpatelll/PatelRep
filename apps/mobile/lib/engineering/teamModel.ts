/* ─── Chief-engineer team model ─────────────────────────────────────────────
   Pure rules for the Team Overview and the Assign Technician sheet. Role checks here only decide what the UI offers:
   the API enforces every permission (POST /work-orders/{id}/assign is chief_engineer + gm, 403 for anyone else). */

import { classifyLoadFailure } from "@/lib/engineering/loadState";
import type { AttentionItem, AttentionKind, Technician, TeamCounts } from "@/lib/api/engineeringTeam";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const MANAGER_ROLES: readonly string[] = ["chief_engineer", "gm"];

export function canManageTeam(role: string | null | undefined): boolean {
  return role != null && MANAGER_ROLES.includes(role);
}

/** Mirrors the server's ASSIGNABLE_STATUSES: a closed order is never offered an assignee. */
const ASSIGNABLE: readonly string[] = ["open", "escalated", "in_progress", "on_hold"];

export function isAssignable(wo: Pick<WorkOrder, "status">): boolean {
  return ASSIGNABLE.includes(wo.status);
}

export function technicianName(tech: Pick<Technician, "name">, fallback: string): string {
  return tech.name?.trim() || fallback;
}

/** Case-insensitive name filter; an empty query keeps the server's order (busiest first). */
export function filterTechnicians(technicians: readonly Technician[], query: string): Technician[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...technicians];
  return technicians.filter((t) => (t.name ?? "").toLowerCase().includes(q));
}

export type AssignFailure = "conflict" | "closed" | "not_allowed" | "invalid" | "not_found" | "offline" | "failed";

/** Maps the API's answer to a message the manager can act on. 409 is both "someone assigned it first" and "it is closed". */
export function classifyAssignError(error: unknown): AssignFailure {
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : "";
  if (status === 409) return /closed/i.test(message) ? "closed" : "conflict";
  if (status === 401 || status === 403) return "not_allowed";
  if (status === 404) return "not_found";
  if (status === 422) return "invalid";
  return classifyLoadFailure(error) === "offline" ? "offline" : "failed";
}

/** Conflict and closed need a fresh read before another try; the rest are a retry of the same request. */
export function needsRefreshAfter(failure: AssignFailure): boolean {
  return failure === "conflict" || failure === "closed" || failure === "not_found";
}

export interface SummaryTile {
  key: "open" | "overdue" | "on_hold" | "unassigned" | "emergency" | "pm_overdue";
  value: number | null;
  /** Needs the manager's eye (shown with the strong treatment, and with a word - never colour alone). */
  alert: boolean;
}

/** The three always-on figures first, then the optional ones that are non-zero or unknown. */
export function summaryTiles(counts: TeamCounts): { primary: SummaryTile[]; secondary: SummaryTile[] } {
  const primary: SummaryTile[] = [
    { key: "open", value: counts.open, alert: false },
    { key: "overdue", value: counts.overdue, alert: counts.overdue > 0 },
    { key: "on_hold", value: counts.on_hold, alert: false },
  ];
  const optional: SummaryTile[] = [
    { key: "emergency", value: counts.emergency, alert: counts.emergency > 0 },
    { key: "unassigned", value: counts.unassigned, alert: false },
    { key: "pm_overdue", value: counts.pm_overdue, alert: (counts.pm_overdue ?? 0) > 0 },
  ];
  return { primary, secondary: optional.filter((tile) => tile.value === null || tile.value > 0) };
}

export const ATTENTION_ORDER: readonly AttentionKind[] = ["emergency_unassigned", "urgent_overdue", "escalated", "on_hold"];

/** Where tapping an attention row goes: always the real work order (no separate management queue). */
export function attentionRoute(item: Pick<AttentionItem, "id">): string {
  return `/(app)/work-orders/${item.id}`;
}

export function workOrderCode(item: Pick<AttentionItem, "work_order_number">): string | null {
  return item.work_order_number ? `WO-${String(item.work_order_number).replace(/^WO-/i, "")}` : null;
}

/** "3 active · 1 urgent" parts, only for counts that exist. */
export function workloadParts(tech: Technician): { active: number; urgent: number; onHold: number; overdue: number } {
  return { active: tech.active, urgent: tech.urgent, onHold: tech.on_hold, overdue: tech.overdue };
}

/** Cache scope for team reads: hotel + person, so another account (or a switched hotel) never sees these figures. */
export function teamScope(user: { id: string; tenant_id?: string | null } | null | undefined): string | null {
  return user?.id && user.tenant_id ? `${user.tenant_id}:${user.id}:team` : null;
}
