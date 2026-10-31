/* ─── Engineering Work Orders queue model ───────────────────────────────────
   Pure rules for the Work tab: which views exist for a role, how a view + filters
   become an API request, which orders belong where, how they sort and group, and
   what a claim failure means. No React, no i18n, no network — the screen and the
   data hook feed it and render the answer.

   The server is the authority. For `engineer` it only ever returns that
   engineer's own and unclaimed orders (apps/api/routers/work_orders.py), so the
   Team view exists only for roles the API lets read everyone's work. */

import { classifyLoadFailure } from "@/lib/engineering/loadState";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import {
  ACTIVE_WORK_ORDER_STATUSES,
  isHighPriority,
  priorityRank,
  type WorkOrder,
  type WorkOrderCategory,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/lib/engineering/workOrders";
import { hotelDateKey, resolveTimeZone } from "@/lib/housekeeping/hotelTime";

export const QUEUE_VIEWS = ["mine", "available", "team", "waiting", "done"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

/** Roles the API lets read other engineers' work orders (the `engineer` list is scoped to own + unclaimed). */
const TEAM_VISIBLE_ROLES: readonly string[] = ["chief_engineer", "gm"];

export function canViewTeamWork(role: string | null | undefined): boolean {
  return role != null && TEAM_VISIBLE_ROLES.includes(role);
}

export function availableViews(role: string | null | undefined): QueueView[] {
  return QUEUE_VIEWS.filter((view) => view !== "team" || canViewTeamWork(role));
}

export type QueueSort = "priority" | "due" | "newest" | "oldest" | "updated";
export const QUEUE_SORTS: readonly QueueSort[] = ["priority", "due", "newest", "oldest", "updated"];

export type QueueDateFilter = "overdue" | "today" | "week" | "recent" | "updated7" | "updated30";
export type QueueAssignment = "any" | "mine" | "unassigned" | "others";

export interface QueueFilters {
  /** Subset of the view's statuses; empty means "the view's default set". */
  statuses: WorkOrderStatus[];
  priority: WorkOrderPriority | null;
  category: WorkOrderCategory | null;
  floor: number | null;
  building: string | null;
  date: QueueDateFilter | null;
  /** Only meaningful in Waiting, where it narrows whose held work is shown. */
  assignment: QueueAssignment;
  /** null = the view's default order. */
  sort: QueueSort | null;
}

export const EMPTY_FILTERS: QueueFilters = {
  statuses: [],
  priority: null,
  category: null,
  floor: null,
  building: null,
  date: null,
  assignment: "any",
  sort: null,
};

export function defaultSort(view: QueueView): QueueSort {
  return view === "done" ? "updated" : "priority";
}

export function effectiveSort(view: QueueView, filters: QueueFilters): QueueSort {
  return filters.sort ?? defaultSort(view);
}

/** The statuses a view can ever show. Waiting is on_hold only; Done is completed or cancelled. */
export function allowedStatuses(view: QueueView): readonly WorkOrderStatus[] {
  switch (view) {
    case "mine":
    case "team":
      return ACTIVE_WORK_ORDER_STATUSES;
    case "available":
      return ["open", "escalated"];
    case "waiting":
      return ["on_hold"];
    case "done":
      return ["completed", "cancelled"];
  }
}

/** Statuses requested for a view: the user's pick, narrowed to what the view allows. Done defaults to completed only. */
export function viewStatuses(view: QueueView, filters: QueueFilters): WorkOrderStatus[] {
  const allowed = allowedStatuses(view);
  const picked = filters.statuses.filter((status) => allowed.includes(status));
  if (view === "done") return picked.length > 0 ? [picked[0]] : ["completed"];
  if (view === "waiting") return ["on_hold"];
  return picked.length > 0 ? picked : [...allowed];
}

export function dateFiltersFor(view: QueueView): QueueDateFilter[] {
  return view === "done" ? ["updated7", "updated30"] : ["overdue", "today", "week", "recent"];
}

/** Whether the view lets the person pick a status at all (Waiting is one status). */
export function hasStatusFilter(view: QueueView): boolean {
  return view !== "waiting";
}

/** Whether Waiting's assignment narrowing applies (an engineer's list is already own + unclaimed). */
export function hasAssignmentFilter(view: QueueView): boolean {
  return view === "waiting";
}

/** Count of filters the person has set (sort counts when it differs from the view's default). */
export function activeFilterCount(view: QueueView, filters: QueueFilters): number {
  let count = 0;
  const statuses = filters.statuses.filter((status) => allowedStatuses(view).includes(status));
  if (hasStatusFilter(view) && statuses.length > 0 && !(view === "done" && statuses[0] === "completed")) count += 1;
  if (filters.priority) count += 1;
  if (filters.category) count += 1;
  if (filters.floor != null || filters.building) count += 1;
  if (filters.date && dateFiltersFor(view).includes(filters.date)) count += 1;
  if (hasAssignmentFilter(view) && filters.assignment !== "any") count += 1;
  if (filters.sort && filters.sort !== defaultSort(view)) count += 1;
  return count;
}

export interface WorkOrderListParams {
  statuses?: WorkOrderStatus[];
  priority?: WorkOrderPriority;
  category?: WorkOrderCategory;
  mine?: boolean;
  unassigned?: boolean;
  assigned_to_others?: boolean;
  floor?: number;
  building?: string;
  q?: string;
  sort_by?: "created_at" | "due_at" | "priority" | "updated_at";
  sort_dir?: "asc" | "desc";
  overdue?: boolean;
  due_from?: string;
  due_to?: string;
  created_after?: string;
  updated_after?: string;
}

const SORT_PARAMS: Record<QueueSort, Pick<WorkOrderListParams, "sort_by" | "sort_dir">> = {
  priority: { sort_by: "priority", sort_dir: "desc" },
  due: { sort_by: "due_at", sort_dir: "asc" },
  newest: { sort_by: "created_at", sort_dir: "desc" },
  oldest: { sort_by: "created_at", sort_dir: "asc" },
  updated: { sort_by: "updated_at", sort_dir: "desc" },
};

const DAY_MS = 86_400_000;

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a hotel-local calendar day (YYYY-MM-DD) begins. */
export function startOfHotelDay(dateKey: string, timeZone: string | null | undefined): Date {
  const zone = resolveTimeZone(timeZone);
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface QueueContext {
  role: string | null | undefined;
  now?: Date;
  timeZone?: string | null;
}

/** Turns a view, its filters and the committed search text into the list request the API understands. */
export function buildListParams(
  view: QueueView,
  filters: QueueFilters,
  search: string,
  { role, now = new Date(), timeZone }: QueueContext
): WorkOrderListParams {
  const params: WorkOrderListParams = { statuses: viewStatuses(view, filters), ...SORT_PARAMS[effectiveSort(view, filters)] };

  switch (view) {
    case "mine":
      params.mine = true;
      break;
    case "available":
      params.unassigned = true;
      break;
    case "team":
      params.assigned_to_others = true;
      break;
    case "waiting":
      if (filters.assignment === "mine") params.mine = true;
      else if (filters.assignment === "unassigned") params.unassigned = true;
      else if (filters.assignment === "others" && canViewTeamWork(role)) params.assigned_to_others = true;
      break;
    case "done":
      // An engineer's history is their own; the API would return only that anyway.
      if (!canViewTeamWork(role)) params.mine = true;
      break;
  }

  if (filters.priority) params.priority = filters.priority;
  if (filters.category) params.category = filters.category;
  if (filters.floor != null) params.floor = filters.floor;
  if (filters.building) params.building = filters.building;

  const date = filters.date && dateFiltersFor(view).includes(filters.date) ? filters.date : null;
  if (date === "overdue") params.overdue = true;
  if (date === "today" || date === "week") {
    const todayKey = hotelDateKey(now, timeZone) ?? now.toISOString().slice(0, 10);
    params.due_from = startOfHotelDay(todayKey, timeZone).toISOString();
    params.due_to = startOfHotelDay(addDays(todayKey, date === "today" ? 1 : 7), timeZone).toISOString();
  }
  if (date === "recent") params.created_after = new Date(now.getTime() - DAY_MS).toISOString();
  if (date === "updated7") params.updated_after = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  if (date === "updated30") params.updated_after = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const q = search.trim();
  if (q) params.q = q;
  return params;
}

/** Stable cache key for a view + request: same inputs, same key, regardless of property order. */
export function queueKey(view: QueueView, params: WorkOrderListParams): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort().join(",") : String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${view}?${entries.map(([key, value]) => `${key}=${value}`).join("&")}`;
}

export interface Viewer {
  userId: string | null | undefined;
  role: string | null | undefined;
}

/**
 * Whether an order is something this view may show. The server filters first; this is the guard that keeps a
 * stray row (an older API that ignores a new filter, a realtime echo) out of a queue it does not belong in.
 */
export function belongsToView(wo: WorkOrder, view: QueueView, viewer: Viewer): boolean {
  const assigned = wo.assigned_to ?? null;
  const active = ACTIVE_WORK_ORDER_STATUSES.includes(wo.status);
  switch (view) {
    case "mine":
      return active && assigned != null && assigned === viewer.userId;
    case "available":
      return assigned == null && (wo.status === "open" || wo.status === "escalated");
    case "team":
      return canViewTeamWork(viewer.role) && active && assigned != null && assigned !== viewer.userId;
    case "waiting":
      return wo.status === "on_hold";
    case "done":
      return wo.status === "completed" || wo.status === "cancelled";
  }
}

/** Open and nobody's: the only state the API's claim endpoint accepts. */
export function isClaimable(wo: WorkOrder, role: string | null | undefined): boolean {
  return canActOnWorkOrders(role) && wo.status === "open" && (wo.assigned_to ?? null) == null;
}

export function isOverdue(wo: WorkOrder, now: Date = new Date()): boolean {
  if (!ACTIVE_WORK_ORDER_STATUSES.includes(wo.status) || !wo.due_at) return false;
  const due = new Date(wo.due_at).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

/** Ascending compare with missing values last, so "no due date" never reads as "due soonest". */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * direction;
}

/** Deterministic order for a sort choice; ties always fall through to id so equal rows never shuffle. */
export function compareWorkOrders(sort: QueueSort): (a: WorkOrder, b: WorkOrder) => number {
  return (a, b) => {
    let result = 0;
    switch (sort) {
      case "priority":
        result =
          priorityRank(a.priority) - priorityRank(b.priority) ||
          compareNullable(time(a.due_at), time(b.due_at), 1) ||
          compareNullable(time(a.created_at), time(b.created_at), -1);
        break;
      case "due":
        result =
          compareNullable(time(a.due_at), time(b.due_at), 1) ||
          priorityRank(a.priority) - priorityRank(b.priority) ||
          compareNullable(time(a.created_at), time(b.created_at), -1);
        break;
      case "newest":
        result = compareNullable(time(a.created_at), time(b.created_at), -1);
        break;
      case "oldest":
        result = compareNullable(time(a.created_at), time(b.created_at), 1);
        break;
      case "updated":
        result = compareNullable(time(a.updated_at), time(b.updated_at), -1);
        break;
    }
    return result || a.id.localeCompare(b.id);
  };
}

/** First occurrence wins, so a row that moved between pages while paging appears once. */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export type MineGroupKey = "escalated" | "in_progress" | "ready" | "on_hold";

export interface MineGroup {
  key: MineGroupKey;
  orders: WorkOrder[];
}

/**
 * My Work, grouped by what the engineer can do next. These are presentation groups over the canonical status:
 * `ready` is simply open work assigned to me. Each order lands in exactly one group.
 */
export function groupMineWork(orders: readonly WorkOrder[], sort: QueueSort = "priority"): MineGroup[] {
  const compare = compareWorkOrders(sort);
  const buckets: Record<MineGroupKey, WorkOrder[]> = { escalated: [], in_progress: [], ready: [], on_hold: [] };
  for (const wo of dedupeById(orders)) {
    if (wo.status === "escalated") buckets.escalated.push(wo);
    else if (wo.status === "in_progress") buckets.in_progress.push(wo);
    else if (wo.status === "on_hold") buckets.on_hold.push(wo);
    else if (wo.status === "open") buckets.ready.push(wo);
  }
  const order: MineGroupKey[] = ["escalated", "in_progress", "ready", "on_hold"];
  return order
    .map((key) => ({ key, orders: buckets[key].sort(compare) }))
    .filter((group) => group.orders.length > 0);
}

export type ClaimFailure = "conflict" | "forbidden" | "not_found" | "offline" | "failed";

/** What a failed claim means. 409 is "someone else got it first" (the API only claims open orders). */
export function classifyClaimError(error: unknown): ClaimFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 409) return "conflict";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return classifyLoadFailure(error) === "offline" ? "offline" : "failed";
}

/** Replays that can never succeed no matter how often they are retried — drop them and tell the person. */
export function isTerminalClaimFailure(error: unknown): boolean {
  const failure = classifyClaimError(error);
  return failure === "conflict" || failure === "forbidden" || failure === "not_found";
}

/** "WO-1042" — the order's number when it has one, else nothing (never an invented id). */
export function workOrderLabel(wo: Pick<WorkOrder, "work_order_number">): string | null {
  return wo.work_order_number ? `WO-${String(wo.work_order_number).replace(/^WO-/i, "")}` : null;
}

/** Where Home's "Urgent" card should land: the viewer's own urgent work if any, else the unclaimed urgent queue. */
export function urgentLandingView(orders: readonly WorkOrder[], viewerId: string | null | undefined): QueueView {
  const urgent = orders.filter((wo) => isHighPriority(wo.priority) && ACTIVE_WORK_ORDER_STATUSES.includes(wo.status));
  if (viewerId != null && urgent.some((wo) => wo.assigned_to === viewerId)) return "mine";
  return urgent.some((wo) => (wo.assigned_to ?? null) == null) ? "available" : "mine";
}
