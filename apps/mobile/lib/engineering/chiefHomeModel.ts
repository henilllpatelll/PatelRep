/* ─── Chief Engineer Home model ─────────────────────────────────────────────
   Pure shaping of GET /engineering/team/overview for the management Home. The server computes every count and decides
   what needs attention; nothing here recounts, guesses or invents. No React, no i18n, no I/O.

   - Summary    exact server counts via the existing manager summary contract (managerSummary.ts); a count the server
                did not give is unknown (null), never zero.
   - Priorities one list built from the overview's own records, ordered by a display policy (below). Records are not
                merged: a work order stays a work order, a PM schedule a PM schedule, the room figure a room figure.
   - Workload   the server's per-technician job counts, with a bar scaled to the busiest technician *shown*. It is a
                relative comparison of job counts only; it is not utilisation, capacity or availability.
   - Rooms      an aggregate. Individual rooms are never fabricated from it. A repair or defective asset is not a room
                being down: only the server's confirmed rooms_down figure is shown. */

import type { AttentionItem, AttentionKind, PmOversight, Technician, TeamCounts, TeamOverview } from "@/lib/api/engineeringTeam";
import type { AssignTarget } from "@/components/engineering/team/AssignTechnicianSheet";
import { managerSummaryCount, type ManagerSummaryKey } from "@/lib/engineering/managerSummary";
import { ROOM_STATUS_ROUTE, TEAM_OVERVIEW_ROUTE, WORK_ROUTE } from "@/lib/engineering/homeNavigation";
import { ASSETS_LIST_ROUTE, PM_LIST_ROUTE, assetRoute, isSafeRouteId, pmScheduleRoute, workOrderRoute, type ParamRoute } from "@/lib/engineering/routes";
import { technicianName, workOrderCode } from "@/lib/engineering/teamModel";
import { priorityRank } from "@/lib/engineering/workOrders";

/* ─── Summary ─────────────────────────────────────────────────────────────── */

export interface ChiefSummaryValue {
  key: ManagerSummaryKey;
  /** null = unknown (older server, or no overview yet). */
  value: number | null;
}

export function chiefSummary(counts: TeamCounts | null | undefined): ChiefSummaryValue[] {
  return (["needsOwner", "inProgress", "waiting"] as const).map((key) => ({ key, value: managerSummaryCount(counts, key) }));
}

/* ─── Property priorities ─────────────────────────────────────────────────── */

/** How many rows Home previews; the rest are one tap away in Team Overview. */
export const PRIORITY_PREVIEW = 4;

export type PriorityItem =
  | { kind: "wo"; key: string; rank: number; wo: AttentionItem }
  | { kind: "rooms"; key: "rooms-down"; rank: number; total: number; pastExpected: number }
  | { kind: "pm"; key: string; rank: number; id: string; name: string | null; assetName: string | null; nextDueAt: string | null }
  | { kind: "repeat"; key: string; rank: number; assetId: string; assetName: string | null; count: number; days: number };

/**
 * Display policy (not a business rule): emergencies needing an owner, urgent and overdue, escalated, confirmed room
 * unavailability, held work, then PM and repeated-defect equipment. Within one kind the server's own order is kept.
 */
export const PRIORITY_RANK = {
  emergency_unassigned: 0,
  urgent_overdue: 1,
  escalated: 2,
  rooms: 3,
  on_hold: 4,
  pm: 5,
  repeat: 6,
} as const satisfies Record<AttentionKind | "rooms" | "pm" | "repeat", number>;

export interface Priorities {
  items: PriorityItem[];
  /** Work orders the server flagged that its short list does not carry (its totals exceed the rows it sent). */
  hiddenWorkOrders: number;
  /** The server could not read this part: unknown, never "all clear". */
  roomsUnavailable: boolean;
  pmUnavailable: boolean;
  /** Nothing needs attention AND every source was readable AND nothing is cut off: the only case a calm state is true. */
  allClear: boolean;
}

function pmItems(pm: PmOversight): PriorityItem[] {
  const out: PriorityItem[] = pm.overdue.map((row) => ({
    kind: "pm" as const,
    key: `pm:${row.id}`,
    rank: PRIORITY_RANK.pm,
    id: row.id,
    name: row.name,
    assetName: row.asset_name,
    nextDueAt: row.next_due_at,
  }));
  for (const row of pm.repeat_defects) {
    out.push({
      kind: "repeat",
      key: `repeat:${row.asset_id}`,
      rank: PRIORITY_RANK.repeat,
      assetId: row.asset_id,
      assetName: row.asset_name,
      count: row.count,
      days: pm.repeat_window_days,
    });
  }
  return out;
}

const time = (iso: string | null | undefined): number => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : t;
};
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tie-break inside one severity. Work orders: priority, then earliest due time (none last), then number, then id. PM: the
 * longest overdue first, then id. Repeated defects: the most repeats first, then asset id. Different kinds never meet here
 * (rank already separated them).
 */
export function comparePriorityItems(a: PriorityItem, b: PriorityItem): number {
  if (a.kind === "wo" && b.kind === "wo") {
    const priority = priorityRank(a.wo.priority) - priorityRank(b.wo.priority);
    if (priority !== 0) return priority;
    const due = time(a.wo.due_at);
    const otherDue = time(b.wo.due_at);
    if (due !== otherDue) return due < otherDue ? -1 : 1;
    return byText(String(a.wo.work_order_number ?? ""), String(b.wo.work_order_number ?? "")) || byText(a.wo.id, b.wo.id);
  }
  if (a.kind === "pm" && b.kind === "pm") {
    const due = time(a.nextDueAt);
    const otherDue = time(b.nextDueAt);
    if (due !== otherDue) return due < otherDue ? -1 : 1;
    return byText(a.id, b.id);
  }
  if (a.kind === "repeat" && b.kind === "repeat") return b.count - a.count || byText(a.assetId, b.assetId);
  return 0;
}

export function buildPriorities(overview: TeamOverview | null | undefined): Priorities {
  if (!overview) return { items: [], hiddenWorkOrders: 0, roomsUnavailable: false, pmUnavailable: false, allClear: false };
  const items: PriorityItem[] = [];

  const seen = new Set<string>();
  for (const wo of overview.needs_attention ?? []) {
    if (!wo?.id || seen.has(wo.id)) continue;
    seen.add(wo.id);
    items.push({ kind: "wo", key: `wo:${wo.id}`, rank: PRIORITY_RANK[wo.kind] ?? PRIORITY_RANK.on_hold, wo });
  }

  const rooms = overview.rooms_down;
  if (rooms && rooms.total > 0) {
    items.push({ kind: "rooms", key: "rooms-down", rank: PRIORITY_RANK.rooms, total: rooms.total, pastExpected: rooms.past_expected_return });
  }
  if (overview.pm_oversight) items.push(...pmItems(overview.pm_oversight));

  // Severity first; inside one severity a fixed tie-break (below) so equal records never swap between refreshes; the
  // server's own order is only the very last resort.
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.rank - b.item.rank || comparePriorityItems(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);

  const flagged = Object.values(overview.attention_counts ?? {}).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  const shownWo = ordered.filter((item) => item.kind === "wo").length;
  const hiddenWorkOrders = Math.max(0, flagged - shownWo);
  const roomsUnavailable = overview.rooms_down == null;
  const pmUnavailable = overview.pm_oversight == null;
  const allClear = ordered.length === 0 && hiddenWorkOrders === 0 && !roomsUnavailable && !pmUnavailable && !overview.truncated;
  return { items: ordered, hiddenWorkOrders, roomsUnavailable, pmUnavailable, allClear };
}

export type PriorityRoute = ParamRoute | string;

/** Where a row opens: the exact record when its id is a safe path segment, otherwise the relevant list (never a bad link). */
export function priorityRoute(item: PriorityItem): PriorityRoute {
  switch (item.kind) {
    case "wo":
      return workOrderRoute(item.wo.id) ?? WORK_ROUTE;
    case "rooms":
      return ROOM_STATUS_ROUTE;
    case "pm":
      return pmScheduleRoute(item.id) ?? PM_LIST_ROUTE;
    case "repeat":
      return assetRoute(item.assetId) ?? ASSETS_LIST_ROUTE;
  }
}

/** One technician's own work list; a malformed id falls back to Team Overview rather than a bad link. */
export function technicianRoute(userId: string | null | undefined): string {
  return isSafeRouteId(userId) ? `${TEAM_OVERVIEW_ROUTE}/${userId}` : TEAM_OVERVIEW_ROUTE;
}

/** The whole picture, for "View all": Team Overview holds work orders, PM oversight and rooms together. */
export const PRIORITIES_VIEW_ALL_ROUTE = TEAM_OVERVIEW_ROUTE;

/**
 * Whether Home offers Assign on a row. Mirrors Team Overview: held work with no owner is not offered an assignee from a
 * list (it needs its hold resolved first). The caller also gates on role; the server enforces both.
 */
export function canAssignFromPriority(item: PriorityItem): item is Extract<PriorityItem, { kind: "wo" }> {
  return item.kind === "wo" && !(item.wo.status === "on_hold" && !item.wo.assigned_to);
}

export function assignTargetFor(wo: AttentionItem): AssignTarget {
  return {
    id: wo.id,
    code: workOrderCode(wo),
    title: wo.title ?? "",
    priority: wo.priority,
    assignedTo: wo.assigned_to,
    assignedToName: wo.assigned_to_name,
    location: wo.room_number ?? null,
  };
}

/* ─── Team workload ───────────────────────────────────────────────────────── */

/** Technicians shown on Home; everyone is in Team Overview. */
export const WORKLOAD_PREVIEW = 4;

export interface WorkloadRow {
  tech: Technician;
  name: string;
  /** 0..1 of the busiest technician shown. A relative comparison of active job counts, nothing more. */
  ratio: number;
}

export function workloadPreview(technicians: readonly Technician[] | null | undefined, fallbackName: string, limit = WORKLOAD_PREVIEW): { rows: WorkloadRow[]; total: number } {
  const all = [...(technicians ?? [])].sort((a, b) => b.active - a.active);
  const shown = all.slice(0, limit);
  const max = shown.reduce((m, t) => Math.max(m, t.active), 0);
  return {
    total: all.length,
    rows: shown.map((tech) => ({ tech, name: technicianName(tech, fallbackName), ratio: max > 0 ? Math.min(1, Math.max(0, tech.active / max)) : 0 })),
  };
}
