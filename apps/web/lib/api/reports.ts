import { apiClient } from '@/lib/api/client'

export interface DailySummary {
  date: string
  room_status_breakdown: Record<string, number>
  tasks_completed_today: number
  open_work_orders: number
}

export interface StaffMetric {
  user_id: string
  name: string
  role: string
  tasks_completed: number
  tasks_total: number
  wo_completed: number
  wo_total: number
  sla_compliance_pct: number
  total_labor_hours: number
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
  completion_rate_pct: number
  sla_compliance_pct: number
  avg_resolution_hours: number
  total_labor_hours: number
  active_sla_breaches: number
  by_category: Record<string, number>
  by_priority: Record<string, number>
}

export interface AIUsageReport {
  period: { start: string; end: string }
  total_credits_used: number
  total_interactions: number
  breakdown_by_type: Record<string, number>
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
}
