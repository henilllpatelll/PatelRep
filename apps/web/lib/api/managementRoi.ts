import { apiClient } from '@/lib/api/client'

export interface RoiPeriod {
  start: string
  end: string
}

export interface RepeatFailuresReport {
  period: RoiPeriod
  window_days: number
  repeat_asset_count: number
  repeat_room_count: number
  total_repeat_work_orders: number
  repeat_assets: { asset_id: string; failure_count: number }[]
  repeat_rooms: { room_id: string; failure_count: number }[]
}

export interface DowntimeRevenueReport {
  period: RoiPeriod
  downtime: {
    total_downtime_hours: number
    rooms_affected: number
    rooms: { room_id: string; downtime_hours: number }[]
  }
  revenue: {
    configured: boolean
    average_daily_rate_cents: number | null
    downtime_hours: number
    revenue_impact_cents: number | null
  }
}

export interface HousekeepingEfficiencyReport {
  period: RoiPeriod
  occupied_room_days: number
  total_clean_minutes: number
  minutes_per_occupied_room: number
  definition: string
  by_room_type: {
    room_type_id: string
    sessions: number
    avg_minutes: number
    baseline_minutes: number | null
    variance_minutes: number | null
    variance_pct: number | null
  }[]
}

export interface InspectionTrendsReport {
  period: RoiPeriod
  total_inspections: number
  passed: number
  failed: number
  conditional: number
  pass_rate_pct: number
  repeat_defect_count: number
  repeat_defects: { template_item_id: string; fail_count: number; inspection_count: number }[]
}

export interface PmComplianceReport {
  period: RoiPeriod
  active_schedules: number
  completed_schedules: number
  completion_rate_pct: number
  deferred_schedules: number
  deferral_rate_pct: number
  repeated_deferral_count: number
  repeated_deferrals: { pm_schedule_id: string; deferral_count: number }[]
}

export interface TrainingReadinessReport {
  generated_for: string
  total_assignments: number
  completed: number
  outstanding: number
  overdue: number
  readiness_pct: number
}

export interface ForecastDay {
  date: string
  weekday: number
  projected_rooms: number
  projected_labor_hours: number
  confidence: 'low' | 'medium' | 'high'
  by_room_type: { room_type_id: string; projected_rooms: number; projected_labor_hours: number }[]
}

export interface ForecastReport {
  generated_for: string
  lookback_weeks: number
  days: ForecastDay[]
}

type RangeParams = { start_date?: string; end_date?: string }

export const managementRoiApi = {
  getRepeatFailures: (params?: RangeParams) =>
    apiClient.get('/reports/roi/repeat-failures', { params }) as Promise<{ data: RepeatFailuresReport }>,

  getDowntimeRevenue: (params?: RangeParams) =>
    apiClient.get('/reports/roi/downtime-revenue', { params }) as Promise<{ data: DowntimeRevenueReport }>,

  getHousekeepingEfficiency: (params?: RangeParams) =>
    apiClient.get('/reports/roi/housekeeping-efficiency', { params }) as Promise<{ data: HousekeepingEfficiencyReport }>,

  getInspectionTrends: (params?: RangeParams) =>
    apiClient.get('/reports/roi/inspection-trends', { params }) as Promise<{ data: InspectionTrendsReport }>,

  getPmCompliance: (params?: RangeParams) =>
    apiClient.get('/reports/roi/pm-compliance', { params }) as Promise<{ data: PmComplianceReport }>,

  getTrainingReadiness: () =>
    apiClient.get('/reports/roi/training-readiness') as Promise<{ data: TrainingReadinessReport }>,

  getForecast: (params?: { lookback_weeks?: number }) =>
    apiClient.get('/reports/roi/forecast-7day', { params }) as Promise<{ data: ForecastReport }>,
}
