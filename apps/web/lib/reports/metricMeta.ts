// Which view owns each KPI, which trend explains it, and which records contribute to it.
// Definitions themselves (what a metric means) come from the API registry — never duplicated here.

import type { RecordKind } from './drawerState'
import type { ReportView } from './filters'

export interface RecordGroup {
  label: string
  kind: RecordKind
  filter: string
}

export interface MetricMeta {
  view: ReportView
  /** Trend series metric id (see apps/api/services/reporting/trends.py) */
  trend?: string
  /** Chart point -> records of this kind for that bucket */
  bucketRecords?: { kind: RecordKind; filter: string }
  records?: RecordGroup[]
  /** Honest note when no underlying record list exists */
  recordsLimitation?: string
  /** Breakdown dimensions supported by /segments */
  segments?: string[]
}

export const METRIC_META: Record<string, MetricMeta> = {
  guest_sla: {
    view: 'guest-experience',
    trend: 'guest_sla',
    bucketRecords: { kind: 'guest_requests', filter: 'all' },
    records: [
      { label: 'Requests that missed their SLA', kind: 'guest_requests', filter: 'sla_missed' },
      { label: 'Requests that met their SLA', kind: 'guest_requests', filter: 'sla_met' },
    ],
    segments: ['category', 'department'],
  },
  guest_verified_resolution: {
    view: 'guest-experience',
    records: [{ label: 'Verified requests', kind: 'guest_requests', filter: 'verified' }, { label: 'All requests in period', kind: 'guest_requests', filter: 'all' }],
  },
  guest_ack_time: { view: 'guest-experience', trend: 'guest_ack_time', recordsLimitation: 'Acknowledgement times are averages; use the trend and the requests list to investigate.', records: [{ label: 'All requests in period', kind: 'guest_requests', filter: 'all' }] },
  guest_resolution_time: { view: 'guest-experience', records: [{ label: 'Verified requests', kind: 'guest_requests', filter: 'verified' }] },
  guest_requests_total: { view: 'guest-experience', records: [{ label: 'All requests in period', kind: 'guest_requests', filter: 'all' }] },
  maintenance_sla: {
    view: 'maintenance',
    trend: 'maintenance_sla',
    bucketRecords: { kind: 'work_orders', filter: 'all' },
    records: [
      { label: 'Completed work orders that missed SLA', kind: 'work_orders', filter: 'sla_missed' },
      { label: 'Completed work orders that met SLA', kind: 'work_orders', filter: 'sla_met' },
      { label: 'Completed work orders excluded (no due time)', kind: 'work_orders', filter: 'sla_excluded' },
    ],
    segments: ['category', 'priority'],
  },
  maintenance_response: { view: 'maintenance', trend: 'maintenance_response', records: [{ label: 'All work orders in period', kind: 'work_orders', filter: 'all' }] },
  maintenance_repair: { view: 'maintenance', trend: 'maintenance_repair', records: [{ label: 'Completed work orders', kind: 'work_orders', filter: 'completed' }] },
  maintenance_completion: {
    view: 'maintenance',
    trend: 'wo_completed',
    records: [{ label: 'Completed work orders', kind: 'work_orders', filter: 'completed' }, { label: 'Still open', kind: 'work_orders', filter: 'open' }],
    segments: ['category', 'priority'],
  },
  active_sla_breaches: { view: 'maintenance', records: [{ label: 'Overdue open work orders (live)', kind: 'work_orders', filter: 'overdue_live' }] },
  inspection_pass: {
    view: 'housekeeping',
    trend: 'inspection_pass',
    bucketRecords: { kind: 'inspections', filter: 'all' },
    records: [{ label: 'Failed inspections', kind: 'inspections', filter: 'failed' }, { label: 'Passed inspections', kind: 'inspections', filter: 'passed' }],
  },
  out_of_order: { view: 'housekeeping', recordsLimitation: 'This is a live status count. Historical out-of-order rooms are not stored, so there is no record list or trend for it.' },
  rooms_serviced: { view: 'housekeeping', recordsLimitation: 'Clean sessions are derived from room status history and are not stored as individual records.' },
  cleaning_minutes: { view: 'housekeeping', trend: 'cleaning_minutes', recordsLimitation: 'Clean sessions are derived from room status history and are not stored as individual records.' },
  repeat_defects: { view: 'housekeeping', recordsLimitation: 'Repeat defects are aggregated per checklist item; see the failed-items table on this screen.' },
  tasks_completed: { view: 'team', records: [{ label: 'Completed tasks', kind: 'tasks', filter: 'completed' }] },
  wo_completed: { view: 'team', trend: 'wo_completed', records: [{ label: 'Completed work orders', kind: 'work_orders', filter: 'completed' }] },
  team_sla: { view: 'team', records: [{ label: 'Work orders that missed SLA', kind: 'work_orders', filter: 'sla_missed' }] },
  labor_hours: { view: 'team', recordsLimitation: 'Labor hours are recorded on work orders only; see each employee for detail.' },
  downtime_hours: { view: 'maintenance', recordsLimitation: 'Downtime is derived from room status transitions and is shown per room in the downtime table.' },
  downtime_exposure: { view: 'management', recordsLimitation: 'This estimate is calculated from recorded downtime hours and the configured ADR; it has no individual records.' },
  pm_compliance: { view: 'maintenance', records: [{ label: 'PM deferrals in period', kind: 'pm_deferrals', filter: 'all' }, { label: 'Repeatedly deferred schedules', kind: 'pm_deferrals', filter: 'repeated' }] },
}

export function metaFor(key: string): MetricMeta | undefined {
  return METRIC_META[key]
}

/** Trend metric ids understood by the API, for the trend-comparison drawer. */
export const TREND_LABELS: Record<string, string> = {
  guest_sla: 'Guest SLA compliance',
  guest_ack_time: 'Average acknowledgement time',
  maintenance_sla: 'Maintenance SLA compliance',
  maintenance_response: 'Average response time',
  maintenance_repair: 'Average repair time',
  wo_created: 'Work orders created',
  wo_completed: 'Work orders completed',
  inspection_pass: 'Inspection pass rate',
  cleaning_minutes: 'Cleaning minutes per room',
}

export function recordsForTrend(metric: string): { kind: RecordKind; filter: string } | null {
  const entry = Object.values(METRIC_META).find((m) => m.trend === metric && m.bucketRecords)
  if (entry?.bucketRecords) return entry.bucketRecords
  if (metric === 'wo_created') return { kind: 'work_orders', filter: 'all' }
  if (metric === 'wo_completed') return { kind: 'work_orders', filter: 'completed' }
  return null
}

/** Breakdown dimensions the /segments endpoint supports per trend metric. */
export const TREND_SEGMENTS: Record<string, string[]> = {
  guest_sla: ['category', 'department'],
  maintenance_sla: ['category', 'priority'],
  wo_created: ['category', 'priority'],
  wo_completed: ['category', 'priority'],
}

/** Trend metrics where a higher value is better (null = no polarity); mirrors the API registry. */
export const TREND_POLARITY: Record<string, boolean | null> = {
  guest_sla: true,
  guest_ack_time: false,
  maintenance_sla: true,
  maintenance_response: false,
  maintenance_repair: false,
  wo_created: null,
  wo_completed: null,
  inspection_pass: true,
  cleaning_minutes: false,
}
