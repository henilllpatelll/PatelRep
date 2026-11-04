/* ─── Engineering Home data contract ────────────────────────────────────────
   The single place that says what every Home number MEANS: which records it counts, who sees it, where it comes from,
   what happens when the source is stale / offline / unreadable, and which screen it opens. The Home screens do not
   count anything themselves; they feed a source answer to `readMetric` and render what comes back.

   Honesty rules (tested):
   - unknown is never zero: a source that has not answered gives `kind: "unknown"`, rendered as "—";
   - a lower bound is never an exact total: a truncated or partial read gives `kind: "lower_bound"`, rendered "N+";
   - a figure kept from before a failed refresh is flagged `stale`, so the screen can say so.
   Pure: no React, no i18n, no network. */

import type { WorkOrderStatus } from "@/lib/engineering/workOrders";

export type HomeMetricKey = "myJobs" | "urgent" | "pmDue" | "needsOwner" | "inProgress" | "onHold";
export type CountKind = "exact" | "lower_bound" | "unknown";

export interface MetricReading {
  count: number | null;
  kind: CountKind;
  /** The figure comes from before the latest read failed. */
  stale: boolean;
}

export const UNKNOWN_DISPLAY = "—";

export const UNKNOWN_READING: MetricReading = { count: null, kind: "unknown", stale: false };

export interface MetricSource {
  /** The server's own exact count, when the endpoint provides one for this scope. */
  exact?: number | null;
  /** A count derived from records that were actually read. Exact only when `complete`. */
  observed?: number | null;
  /** Every record of the scope was read (no page cut off, no section missing). */
  complete?: boolean;
  /** The source has answered at least once for this hotel + person. */
  available: boolean;
  /** The latest refresh failed, so what is shown is the last good answer. */
  stale?: boolean;
}

/** Exact beats observed-and-complete beats observed-but-partial beats nothing. Never fabricates a number. */
export function readMetric(source: MetricSource): MetricReading {
  if (!source.available) return UNKNOWN_READING;
  const stale = source.stale === true;
  if (typeof source.exact === "number" && Number.isInteger(source.exact) && source.exact >= 0) return { count: source.exact, kind: "exact", stale };
  if (typeof source.observed === "number" && Number.isInteger(source.observed) && source.observed >= 0) {
    return { count: source.observed, kind: source.complete === true ? "exact" : "lower_bound", stale };
  }
  return UNKNOWN_READING;
}

export function formatMetric(reading: MetricReading): string {
  if (reading.count == null || reading.kind === "unknown") return UNKNOWN_DISPLAY;
  return reading.kind === "lower_bound" ? `${reading.count}+` : String(reading.count);
}

/** Work-order statuses a technician can act on right now. On-hold work is waiting, not a job to do. */
export const MY_JOBS_STATUSES: readonly WorkOrderStatus[] = ["open", "escalated", "in_progress"];

export type MetricRole = "technician" | "chief_engineer";
export type MetricSourceId = "work-orders/summary" | "work-orders (active page)" | "pm-schedules" | "engineering/team/overview";

export interface MetricDefinition {
  key: HomeMetricKey;
  roles: readonly MetricRole[];
  /** Exactly what is counted (human-readable; the tests pin the code to it). */
  scope: string;
  source: readonly MetricSourceId[];
  refresh: string;
  offline: string;
  unknown: string;
  /** The destination, expressed as the route builder that owns it (homeNavigation.ts). */
  destination: string;
  freshness: string;
}

const REFRESH = "initial open, screen focus (not within 15 s of the last read), realtime work-order change (coalesced), pull-to-refresh, Retry";

export const HOME_METRICS: Readonly<Record<HomeMetricKey, MetricDefinition>> = {
  myJobs: {
    key: "myJobs",
    roles: ["technician"],
    scope: "Active work assigned to me in open, escalated or in_progress. On-hold, completed and cancelled work is excluded.",
    source: ["work-orders/summary", "work-orders (active page)"],
    refresh: REFRESH,
    offline: "Last read of this session or the saved queue, shown as a lower bound and labelled stale; never invented.",
    unknown: "Shown as — until a source answered.",
    destination: "myJobsRoute -> Work > My Work narrowed to open + escalated + in progress",
    freshness: "Time of the last successful work-order read (connection line).",
  },
  urgent: {
    key: "urgent",
    roles: ["technician"],
    scope: "Emergency and urgent work in any active status (open, escalated, in_progress, on_hold) that this person can read: their own and unclaimed.",
    source: ["work-orders (active page)"],
    refresh: REFRESH,
    offline: "Last read, lower bound when the queue was cut off or saved; labelled stale.",
    unknown: "Shown as — until the work queue was read.",
    destination: "urgentWorkRoute -> Work > All narrowed to urgent",
    freshness: "Time of the last successful work-order read.",
  },
  pmDue: {
    key: "pmDue",
    roles: ["technician"],
    scope: "Active PM schedules overdue or due today on the hotel calendar (hotel timezone).",
    source: ["pm-schedules"],
    refresh: REFRESH,
    offline: "Last PM read of this session, labelled stale; unknown after a restart.",
    unknown: "Shown as — until PM schedules were read; the PM section reports its own failure.",
    destination: "PM_LIST_ROUTE -> PM list",
    freshness: "Time of the last successful PM read.",
  },
  needsOwner: {
    key: "needsOwner",
    roles: ["chief_engineer"],
    scope: "Unassigned work in open or escalated: the Available Work queue.",
    source: ["engineering/team/overview"],
    refresh: REFRESH,
    offline: "Last overview of this session, labelled stale.",
    unknown: "Shown as — when the overview has not answered or the server gave no figure.",
    destination: "chiefSummaryRoute(needsOwner) -> Work > Available",
    freshness: "Overview generated_at / last successful read.",
  },
  inProgress: {
    key: "inProgress",
    roles: ["chief_engineer"],
    scope: "Assigned work in in_progress, hotel-wide.",
    source: ["engineering/team/overview"],
    refresh: REFRESH,
    offline: "Last overview of this session, labelled stale.",
    unknown: "Shown as — when the overview has not answered.",
    destination: "chiefSummaryRoute(inProgress) -> Work > Team narrowed to in progress",
    freshness: "Overview generated_at / last successful read.",
  },
  onHold: {
    key: "onHold",
    roles: ["chief_engineer"],
    scope: "Work in on_hold, assigned or not, hotel-wide.",
    source: ["engineering/team/overview"],
    refresh: REFRESH,
    offline: "Last overview of this session, labelled stale.",
    unknown: "Shown as — when the overview has not answered.",
    destination: "chiefSummaryRoute(waiting) -> Work > Waiting",
    freshness: "Overview generated_at / last successful read.",
  },
};

export function metricVisibleTo(key: HomeMetricKey, role: MetricRole): boolean {
  return HOME_METRICS[key].roles.includes(role);
}
