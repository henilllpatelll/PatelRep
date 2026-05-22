import { apiClient } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskType = 'housekeeping' | 'engineering' | 'guest_request' | 'general'
export type Priority = 'urgent' | 'normal' | 'low'

export interface ParsedTask {
  title: string
  description?: string
  task_type: TaskType
  priority: Priority
  room_id: string | null
  room_number_display: string | null
  due_at?: string
  confidence: number
}

export interface TaskPreviewResponse {
  response_type: 'task_preview'
  message: string
  tasks: ParsedTask[]
  requires_confirmation: boolean
  credits_used: number
  model_used: string
}

export interface AnswerResponse {
  response_type: 'answer'
  message: string
  credits_used: number
  model_used: string | null
  actions?: Array<{ label: string; type: string }>
}

export interface InsightsResponse {
  response_type: 'insights'
  message: string
  insights: Insight[]
  credits_used: number
  model_used: string
}

export interface WorkOrderPreview {
  title: string
  category: 'plumbing' | 'electrical' | 'hvac' | 'furniture' | 'appliance' | 'structural' | 'safety' | 'general'
  priority: Priority
  room_number?: string
  room_id?: string | null
  location_text?: string
  description?: string
}

export interface GuestRequestPreview {
  title: string
  room_number?: string
  room_id?: string | null
  guest_name?: string
  description?: string
}

export interface AssignmentPreview {
  staff_name_hint: string
  staff_id?: string | null
  room_numbers: string[]
  task_ids: string[]
}

export interface AmbiguousOption {
  label: string
  intent_hint: string
}

export interface WorkOrderPreviewResponse {
  response_type: 'work_order_preview'
  message: string
  work_orders: WorkOrderPreview[]
  requires_confirmation: boolean
  credits_used: number
  model_used: string
}

export interface GuestRequestPreviewResponse {
  response_type: 'guest_request_preview'
  message: string
  requests: GuestRequestPreview[]
  requires_confirmation: boolean
  credits_used: number
  model_used: string
}

export interface AssignmentPreviewResponse {
  response_type: 'assignment_preview'
  message: string
  assignments: AssignmentPreview[]
  requires_confirmation: boolean
  credits_used: number
  model_used: string
}

export interface AmbiguousResponse {
  response_type: 'ambiguous'
  message: string
  options: AmbiguousOption[]
  credits_used: number
  model_used: string | null
}

export type CopilotResponse =
  | TaskPreviewResponse
  | AnswerResponse
  | InsightsResponse
  | WorkOrderPreviewResponse
  | GuestRequestPreviewResponse
  | AssignmentPreviewResponse
  | AmbiguousResponse

export interface Insight {
  type: 'labor_efficiency' | 'sla_risk' | 'maintenance_pattern' | 'cost_savings' | 'staffing'
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  action: string
}

export interface RiskAlerts {
  housekeeping_risks: Array<{
    room_id: string
    risk_level: string
    predicted_ready_at: string
    rooms: { room_number: string }
  }>
  maintenance_risks: Array<{ name: string; failure_risk_score: number }>
  sla_breaches: Array<{ work_order_number: string; title: string; due_at: string }>
}

// ── API client ───────────────────────────────────────────────────────────────

export const aiApi = {
  chat: (message: string, context?: Record<string, unknown>): Promise<{ data: CopilotResponse }> =>
    apiClient.post('/ai/copilot/chat', { message, context }),

  confirmTasks: (tasks: ParsedTask[]): Promise<{ data: { created_count: number; tasks: unknown[] } }> =>
    apiClient.post('/ai/tasks/confirm', tasks),

  confirmWorkOrders: (workOrders: WorkOrderPreview[]): Promise<{ data: { created_count: number; work_orders: unknown[] } }> =>
    apiClient.post('/ai/work-orders/confirm', workOrders),

  confirmGuestRequests: (requests: GuestRequestPreview[]): Promise<{ data: { created_count: number; requests: unknown[] } }> =>
    apiClient.post('/ai/guest-requests/confirm', requests),

  confirmAssignments: (assignments: AssignmentPreview[]): Promise<{ data: { assigned_count: number } }> =>
    apiClient.post('/ai/assignments/confirm', assignments),

  batchCreateTasks: (tasks: ParsedTask[]): Promise<{ data: { created_count: number; tasks: unknown[] } }> =>
    apiClient.post('/tasks/batch', tasks),

  getRiskAlerts: (): Promise<{ data: RiskAlerts }> =>
    apiClient.get('/ai/risk-alerts'),

  getInsights: (): Promise<{ data: { insights: Insight[]; credits_used: number } }> =>
    apiClient.get('/ai/insights'),
}
