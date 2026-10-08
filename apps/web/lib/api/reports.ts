import { apiClient } from '@/lib/api/client'

export interface DailySummary {
  date: string
  /** false for a past date: room status / open work orders are live snapshots with no history */
  is_live?: boolean
  room_status_breakdown: Record<string, number> | null
  tasks_completed_today: number
  open_work_orders: number | null
  availability?: Record<string, 'available' | 'unavailable'>
  unavailable_reason?: string
}

export interface StaffMetric {
  user_id: string
  name: string
  role: string
  tasks_completed: number
  tasks_total: number
  wo_completed: number
  wo_total: number
  /** null when no completed item had a deadline (not 0%) */
  sla_compliance_pct: number | null
  /** null when no labor was recorded (not 0) */
  total_labor_hours: number | null
}

export interface StaffPerformanceReport {
  period: { start: string; end: string }
  metrics: StaffMetric[]
  total_staff: number
}

export interface MaintenanceReport {
  period: { start: string; end: string }
  total_work_orders: number
  completed: number
  completion_rate_pct: number | null
  /** null when no completed work order had a due time (not 0%) */
  sla_compliance_pct: number | null
  sla_eligible?: number
  sla_met?: number
  avg_resolution_hours: number | null
  avg_response_hours: number | null
  avg_repair_hours: number | null
  total_labor_hours: number | null
  /** legacy: open + overdue within the period cohort */
  active_sla_breaches: number
  /** live inventory of all open overdue work orders */
  live_active_sla_breaches?: number
  guest_reported_count: number
  by_category: Record<string, number>
  by_priority: Record<string, number>
}

export interface AIUsageReport {
  period: { start: string; end: string }
  total_credits_used: number
  total_interactions: number
  breakdown_by_type: Record<string, number>
}

export interface GuestRecoveryReport {
  period: { start: string; end: string }
  total_requests: number
  verified_resolution_rate_pct: number
  sla_met_rate_pct: number
  average_acknowledgement_minutes: number
  average_verified_resolution_minutes: number
  by_category: Record<string, number>
}

export const reportsApi = {
  getDailySummary: (date?: string) =>
    apiClient.get('/reports/daily-summary', { params: date ? { date } : {} }) as Promise<{ data: DailySummary }>,

  getStaffPerformance: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get('/reports/staff-performance', { params }) as Promise<{ data: StaffPerformanceReport }>,

  getMaintenance: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get('/reports/maintenance', { params }) as Promise<{ data: MaintenanceReport }>,

  getAIUsage: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get('/reports/ai-usage', { params }) as Promise<{ data: AIUsageReport }>,

  getGuestRecovery: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get('/reports/guest-recovery', { params }) as Promise<{ data: GuestRecoveryReport }>,
}
