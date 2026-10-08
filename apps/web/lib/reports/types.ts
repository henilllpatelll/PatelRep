// Payload types for the Reports API (apps/api/routers/report_views.py, report_exports.py).
import type { Availability, Comparison } from './format'

export interface PeriodInfo {
  start: string
  end: string
  timezone: string
  days: number
}

export interface Kpi {
  key: string
  label: string
  unit: string | null
  value: number | null
  availability: Availability
  scope: 'period' | 'live' | 'forecast'
  comparison: Comparison | null
  previous: number | null
  change: number | null
  change_kind: 'percentage_points' | 'percent' | null
  direction: 'favorable' | 'unfavorable' | 'neutral' | null
  eligible: number | null
  numerator: number | null
  sample_size: number | null
  low_sample: boolean
  note: string | null
  secondary: Record<string, unknown> | null
}

export type ExceptionTarget =
  | { type: 'records'; kind: string; filter: string; priority?: string; priority_not?: string }
  | { type: 'view'; view: string }
  | { type: 'route'; href: string }

export interface ExceptionItem {
  key: string
  severity: 'critical' | 'high' | 'medium' | 'info'
  title: string
  detail: string
  count: number
  department: string | null
  target: ExceptionTarget | null
}

export interface TrendPoint {
  bucket: string
  start: string
  end: string
  value: number | null
  sample_size: number
  eligible?: number
  met?: number
}

export interface TrendSeries {
  metric: string
  label: string
  unit: string | null
  definition_key: string | null
  granularity: 'day' | 'week' | 'month'
  period: PeriodInfo
  points: TrendPoint[]
  total: number | null
  comparison: { period: PeriodInfo; points: TrendPoint[]; total: number | null } | null
}

export interface RankedRow {
  key: string
  count: number
  share_pct: number | null
}

export interface ViewBase {
  view: string
  period: PeriodInfo
  comparison_period: PeriodInfo | null
  kpis: Kpi[]
  truncated?: boolean
}

export interface OverviewData extends ViewBase {
  needs_attention: ExceptionItem[]
  trends: Record<string, TrendSeries>
  departments: { department: string; measures: Kpi[] }[]
  daily_brief: null | {
    scope: 'live'
    as_of_date: string
    tasks_completed_today: number
    open_work_orders: number
    room_status: Record<string, number>
  }
}

export interface GuestData extends ViewBase {
  categories: RankedRow[]
  needs_review: {
    counts: { breached: number; near_deadline: number; unverified_resolution: number }
    total: number
    rows: Array<{
      id: string
      request_number: number | null
      room: string | null
      category: string
      summary: string | null
      created_at: string
      department: string | null
      sla_state: 'breached' | 'near_deadline' | 'unverified_resolution'
      status: string
    }>
  }
  departments: Array<{
    department: string
    label: string
    total_requests: number
    sla_eligible: number
    sla_compliance_pct: number | null
    avg_acknowledgement_minutes: number | null
    low_sample: boolean
  }>
}

export interface StaffingOutlook {
  availability: 'available' | 'unavailable' | 'not_enough_data'
  reason?: string
  horizon?: string
  basis?: string
  days?: Array<{
    date: string
    projected_rooms: number | null
    projected_labor_hours: number | null
    required_housekeepers: number | null
    scheduled_housekeepers: number | null
    staffing_gap: number | null
  }>
}

export interface RoomTypeRow {
  room_type_id: string
  code: string | null
  name: string | null
  sessions: number
  avg_minutes: number
  baseline_minutes: number | null
  variance_minutes: number | null
  variance_pct: number | null
  low_sample?: boolean
}

export interface HousekeepingData extends ViewBase {
  room_types: RoomTypeRow[]
  inspection_quality: {
    total: number
    passed: number
    failed: number
    conditional: number
    shares: { passed: number | null; failed: number | null; conditional: number | null }
    top_failed_items: Array<{ template_item_id: string; section: string | null; description: string | null; fail_count: number }>
    failed_by_section: Array<{ section: string; fail_count: number }>
    repeat_defects: Array<{ template_item_id: string; fail_count: number; section: string | null; description: string | null }>
  }
  staffing_outlook: StaffingOutlook
}

export interface PmSection {
  active_schedules: number
  completed_schedules: number
  compliance_pct: number | null
  deferred_schedules: number
  repeated_deferral_count: number
  top_deferrals: Array<{ pm_schedule_id: string; name: string; asset_id: string | null; deferral_count: number; deferred_until: string | null; reason: string | null }>
}

export interface MaintenanceData extends ViewBase {
  totals: { total_work_orders: number; completed: number; labor_hours: number | null }
  active_breaches: {
    scope: 'live'
    overdue_count: number
    urgent_overdue_count: number
    open_work_orders: number
    oldest: null | { id: string; title: string | null; due_at: string; room: string | null }
  }
  by_category: RankedRow[]
  by_priority: RankedRow[]
  repeat_failures: Array<{
    kind: 'room' | 'asset'
    id: string
    label: string
    failure_count: number
    categories: RankedRow[]
    most_recent_at: string | null
  }>
  preventive_maintenance: PmSection
  downtime: {
    total_hours: number | null
    rooms_affected: number
    rooms: Array<{ room_id: string; room: string | null; downtime_hours: number }>
    return_to_service: { availability: string; reason: string }
    revenue_exposure: null | { configured: boolean; estimate_cents: number | null; is_estimate: boolean }
  }
}

export interface StaffRow {
  user_id: string
  name: string
  role: string
  department: string | null
  tasks_completed: number
  tasks_total: number
  wo_completed: number
  wo_total: number
  sla_eligible: number
  sla_met: number
  sla_compliance_pct: number | null
  total_labor_hours: number | null
  labor_tracked_count: number
  open_assignments: number
  low_sample: boolean
}

export interface TeamData extends ViewBase {
  staff: StaffRow[]
  meta: { page: number; per_page: number; total: number }
  roles: string[]
  notes: string[]
}

export interface ManagementData {
  view: 'management'
  period: PeriodInfo
  comparison_period: PeriodInfo | null
  time_labor: {
    kpis: Kpi[]
    by_room_type: RoomTypeRow[]
    trend: TrendSeries
    forecast_labor_hours: Array<{ date: string; projected_labor_hours: number | null }> | null
  }
  quality_risk: {
    kpis: Kpi[]
    repeat_room_failures: Array<{ room_id: string; room: string | null; failure_count: number }>
    repeat_asset_failures: Array<{ asset_id: string; failure_count: number }>
    training_readiness: Record<string, number | null>
  }
  guest_response: { kpis: Kpi[] }
  maintenance_pm: {
    preventive_maintenance: PmSection
    high_downtime_rooms: Array<{ room_id: string; room: string | null; downtime_hours: number }>
  }
  downtime_exposure: {
    total_downtime_hours: number | null
    rooms_affected: number
    estimate_cents: number | null
    adr_configured: boolean
    is_estimate: boolean
    caveat: string
  }
  staffing_forecast: StaffingOutlook
  ai_usage: { total_credits_used: number; total_interactions: number; breakdown_by_type: Record<string, number>; truncated: boolean }
}

export type AnyViewData = OverviewData | GuestData | HousekeepingData | MaintenanceData | TeamData | ManagementData

export interface Capabilities {
  role: string | null
  views: string[]
  departments: string[]
  can_export: boolean
  schedulable_views: string[]
  financial_access: boolean
}

export interface MetricDefinition {
  label: string
  unit: string
  higher_is_better: boolean | null
  scope: 'period' | 'live' | 'forecast'
  definition: string
  numerator: string
  denominator: string
  cohort: string
  exclusions: string
  source: string
}

export interface RecordsResult {
  kind: string
  filter: string
  period: PeriodInfo
  rows: Array<Record<string, any>>
  meta: { page: number; per_page: number; total: number }
  truncated: boolean
  scope: 'live' | 'period'
}

export interface EmployeeData {
  employee: { user_id: string; name: string; role: string; department: string | null }
  period: PeriodInfo
  kpis: Array<Kpi | null>
  trend: { completed: TrendPoint[]; sla: TrendPoint[] }
  work_breakdown: { type: string; rows: Array<{ key: string; count: number }> }
  exceptions: { sla_misses: number; open_assignments: number; overdue_open: number }
  low_sample: boolean
  notes: string[]
}

export interface RoomAssetData {
  entity: { kind: 'room' | 'asset'; id: string; label: string; current_status: string | null }
  period: PeriodInfo
  kpis: Kpi[]
  downtime: { availability: string; hours?: number; reason?: string }
  latest_repair_at: string | null
  repeat_notice: string | null
  timeline: Array<{ at: string; type: string; id: string; title: string | null; category?: string; status?: string; priority?: string }>
  no_data: boolean
}

export interface SegmentsData {
  metric: string
  dimension: string
  dimensions: string[]
  segments: Array<{ segment: string; value: number | null; sample_size: number; previous: number | null; previous_sample_size: number; low_sample: boolean }>
}

export interface ScheduleRecipient {
  user_id: string
  name: string
}

export interface ReportSchedule {
  id: string
  name: string
  report_type: string
  frequency: 'daily' | 'weekly' | 'monthly'
  day_of_week: number | null
  day_of_month: number | null
  local_time: string
  timezone: string
  reporting_window: string
  output_format: 'pdf' | 'csv'
  enabled: boolean
  department: string | null
  include_definitions: boolean
  recipients: ScheduleRecipient[]
  next_run_at: string | null
  last_run_at: string | null
  last_delivery: null | { status: string; scheduled_occurrence: string; completed_at: string | null }
  description: string
  created_by: string | null
}

export interface ScheduleInput {
  name: string
  report_type: string
  frequency: string
  day_of_week?: number | null
  day_of_month?: number | null
  local_time: string
  reporting_window?: string
  output_format: string
  recipient_ids: string[]
  department?: string | null
  include_definitions?: boolean
}

export interface SchedulePreview {
  timezone: string
  next_delivery: string
  following_delivery: string
  reporting_window: { key: string; start: string; end: string }
  description: string
}

export interface DeliveryRow {
  id: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'not_configured' | 'skipped'
  scheduled_occurrence: string
  started_at: string | null
  completed_at: string | null
  recipient_count: number
  error_summary: string | null
  attempts: number
  next_retry_at: string | null
}

export interface DeliveryStatus {
  configured: boolean
  missing: string[]
  blocked_reason: string | null
  required_env: string[]
}
