import type { PmScheduleRow } from "./assets";
import { api } from "./client";

/* Chief Engineer PM management (routers/pm_management.py). Every call is property-scoped by the server; nothing here
   grants a permission, and every write sends the version the person saw so a stale screen cannot overwrite a newer one. */

export interface PmSummary {
  overdue: number;
  unassigned: number;
  pending_approvals: number;
  due_this_week: number;
  active_schedules: number;
  timezone: string;
  week_ends_at: string;
}

/** A schedule as the management lists see it: the schedule row plus its current (non-lapsed) assignee. */
export interface PmProgram extends PmScheduleRow {
  row_version: number;
  effective_assigned_to: string | null;
  assignment_lapsed: boolean;
  assignee_name: string | null;
  is_overdue: boolean;
  checklist_issue: boolean;
}

export interface PmTechnician {
  id: string;
  name: string | null;
  role: string | null;
}

export interface PmWorkloadCard extends PmTechnician {
  assigned: number;
  due_today: number;
  overdue: number;
  completed: number;
  next_due_at: string | null;
  /** Still holds live work but is no longer an active engineer here (deactivated / role removed). */
  ineligible?: boolean;
}

export interface PmWorkload {
  cards: PmWorkloadCard[];
  unassignedSchedules: number;
  truncated: boolean;
}

export type PmPerformancePeriod = "today" | "week" | "month";

export interface PmPerformance {
  period: PmPerformancePeriod;
  period_start: string;
  period_end: string;
  completed_on_time: number;
  completed_late: number;
  no_recorded_deadline: number;
  completed_total: number;
  inspections_with_findings: number;
  still_overdue: number;
  upcoming_7_days: number;
  deferrals_approved: number;
  /** null = no completion with a recorded deadline in the period (never shown as 0%). */
  on_time_rate: number | null;
  rate_basis: { numerator: number; denominator: number };
}

export interface PmDeferralRequest {
  id: string;
  pm_schedule_id: string;
  schedule_name: string | null;
  asset_name: string | null;
  asset_tag: string | null;
  location_text: string | null;
  current_due_at: string | null;
  schedule_active: boolean | null;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  requested_due_at: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  /** The schedule already reached or passed the requested date, so the server will refuse an approval. */
  stale: boolean;
}

export async function getPmSummary(): Promise<PmSummary> {
  return (await api.get<{ data: PmSummary }>("/pm-management/summary")).data;
}

export interface ProgramQuery {
  q?: string;
  status?: "active" | "inactive" | "all";
  overdueOnly?: boolean;
  missingChecklist?: boolean;
  unassignedOnly?: boolean;
  assigneeId?: string | null;
  sort?: "due" | "name";
  offset?: number;
  limit?: number;
}

export function programParams(query: ProgramQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.status && query.status !== "active") params.set("status", query.status);
  if (query.overdueOnly) params.set("overdue_only", "true");
  if (query.missingChecklist) params.set("missing_checklist", "true");
  if (query.unassignedOnly) params.set("unassigned_only", "true");
  if (query.assigneeId) params.set("assignee_id", query.assigneeId);
  if (query.sort && query.sort !== "due") params.set("sort", query.sort);
  params.set("limit", String(query.limit ?? 25));
  params.set("offset", String(query.offset ?? 0));
  return params.toString();
}

export async function listPmPrograms(query: ProgramQuery = {}): Promise<{ rows: PmProgram[]; total: number; hasMore: boolean }> {
  const res = await api.get<{ data: PmProgram[] | null; meta?: { total?: number; has_more?: boolean } }>(`/pm-management/programs?${programParams(query)}`);
  const rows = res.data ?? [];
  return { rows, total: res.meta?.total ?? rows.length, hasMore: res.meta?.has_more === true };
}

export async function listPmTechnicians(): Promise<PmTechnician[]> {
  return (await api.get<{ data: PmTechnician[] | null }>("/pm-management/technicians")).data ?? [];
}

export async function getPmWorkload(period: "today" | "week"): Promise<PmWorkload> {
  const res = await api.get<{ data: PmWorkloadCard[] | null; meta?: { unassigned_schedules?: number; truncated?: boolean } }>(`/pm-management/workload?period=${period}`);
  return { cards: res.data ?? [], unassignedSchedules: res.meta?.unassigned_schedules ?? 0, truncated: res.meta?.truncated === true };
}

export async function getPmPerformance(period: PmPerformancePeriod, technicianId?: string | null): Promise<PmPerformance> {
  const params = new URLSearchParams({ period });
  if (technicianId) params.set("technician_id", technicianId);
  return (await api.get<{ data: PmPerformance }>(`/pm-management/performance?${params}`)).data;
}

/** Assign (assigneeId) or unassign (null) the technician for the schedule's CURRENT inspection. */
export async function assignPmSchedule(scheduleId: string, assigneeId: string | null, expectedVersion: number): Promise<PmProgram> {
  const res = await api.put<{ data: PmProgram }>(`/pm-management/schedules/${scheduleId}/assignment`, {
    assignee_id: assigneeId,
    expected_version: expectedVersion,
  });
  return res.data;
}

export async function listPmDeferralRequests(status: "pending" | "decided" = "pending"): Promise<PmDeferralRequest[]> {
  return (await api.get<{ data: PmDeferralRequest[] | null }>(`/pm-management/deferrals?status=${status}`)).data ?? [];
}

/** A request, not an approval: the server records who asked from the signed-in session and leaves the due date alone. */
export async function requestPmDeferral(scheduleId: string, input: { reason: string; deferredUntil: string }): Promise<void> {
  await api.post(`/programs/pm-schedules/${scheduleId}/deferrals`, { reason: input.reason, deferred_until: input.deferredUntil });
}

/** The reviewer is whoever is signed in; the server refuses the requester and a second decision. */
export async function decidePmDeferral(deferralId: string, decision: "approved" | "rejected", note: string | null): Promise<void> {
  const action = decision === "approved" ? "approve" : "reject";
  await api.post(`/programs/pm-deferrals/${deferralId}/${action}`, { note: note?.trim() || null });
}

export type Criticality = "low" | "medium" | "high" | "life_safety";

export async function setAssetCriticality(assetId: string, input: { criticality: Criticality; reason: string | null; expectedRowVersion?: number | null }): Promise<void> {
  await api.put(`/assets/${assetId}/criticality`, {
    criticality: input.criticality,
    reason: input.reason?.trim() || null,
    expected_row_version: input.expectedRowVersion ?? null,
  });
}

/* ── schedule management (create, edit, checklist, deactivate) ── */

export type PmIntervalType = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "custom";

export interface PmScheduleCreateBody {
  asset_id: string;
  name: string;
  description?: string | null;
  interval_type: PmIntervalType;
  interval_days?: number | null;
  estimated_minutes: number;
  next_due_at: string;
  recurrence_basis: "scheduled_date" | "completion_date";
  checklist_template_id?: string | null;
}

/** The server validates the property, the equipment (active, same property) and the procedure (active, engineering). */
export async function createPmSchedule(body: PmScheduleCreateBody): Promise<{ id: string }> {
  return (await api.post<{ data: { id: string } }>("/assets/pm-schedules", body)).data;
}

/** Edits send only what changed plus the version the manager saw; a newer version on the server refuses (409 version_conflict). */
export async function updatePmSchedule(scheduleId: string, changes: Record<string, unknown>, expectedVersion: number): Promise<void> {
  await api.patch(`/assets/pm-schedules/${scheduleId}`, { ...changes, expected_version: expectedVersion });
}

/** Bind (or null = unbind) the procedure. Past inspections keep the procedure they were done against. */
export async function assignPmChecklist(scheduleId: string, templateId: string | null): Promise<void> {
  await api.put(`/assets/pm-schedules/${scheduleId}/checklist`, { checklist_template_id: templateId });
}

/** Soft deactivation: completions, history and the equipment stay; future inspections stop being scheduled. */
export async function deactivatePmSchedule(scheduleId: string): Promise<void> {
  await api.delete(`/assets/pm-schedules/${scheduleId}`);
}

/* ── equipment attention overview ── */

export interface AssetOverviewItem {
  id: string;
  name: string | null;
  asset_tag: string | null;
  location_text: string | null;
  criticality: Criticality | null;
  warranty_expires: string | null;
  downtime_impact: string | null;
}

export interface AssetOverviewSection {
  count: number;
  items: AssetOverviewItem[];
}

export interface AssetOverview {
  critical: AssetOverviewSection;
  out_of_service: AssetOverviewSection;
  active_repairs: AssetOverviewSection;
  warranty_expiring: AssetOverviewSection;
  warranty_expired: AssetOverviewSection;
  retired: { count: number };
  active_assets: number;
  warranty_unknown: number;
  warranty_window_days: number;
}

export async function getAssetOverview(): Promise<AssetOverview> {
  return (await api.get<{ data: AssetOverview }>("/pm-management/asset-overview")).data;
}
