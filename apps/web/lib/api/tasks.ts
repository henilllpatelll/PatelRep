import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled' | 'escalated'
export type TaskType = 'housekeeping' | 'engineering' | 'guest_request' | 'lost_found' | 'general'
export type Priority = 'urgent' | 'normal' | 'low'

export interface Task {
  id: string
  title: string
  description?: string
  task_type: TaskType
  priority: Priority
  status: TaskStatus
  room_id?: string
  location_text?: string
  department_id?: string
  assigned_to?: string
  assigned_by?: string
  created_by: string
  is_ai_created: boolean
  ai_confidence?: number
  sla_minutes: number
  due_at?: string
  started_at?: string
  completed_at?: string
  cancelled_at?: string
  escalated_at?: string
  created_at: string
  updated_at: string
  // Joined relations
  rooms?: { room_number: string; floor?: number }
  user_profiles?: { preferred_name?: string | null; full_name?: string | null } | null
  creator_profile?: { preferred_name?: string | null; full_name?: string | null } | null
  assigner_profile?: { preferred_name?: string | null; full_name?: string | null } | null
  task_comments?: TaskComment[]
}

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  comment: string
  is_system: boolean
  created_at: string
  user_profiles?: { preferred_name?: string | null; full_name?: string | null } | null
}

export interface CreateTaskData {
  title: string
  description?: string
  task_type: TaskType
  priority: Priority
  room_id?: string
  location_text?: string
  department_id?: string
  assigned_to?: string
  due_at?: string
}

export interface UpdateTaskData {
  status?: TaskStatus
  task_type?: TaskType
  priority?: Priority
  assigned_to?: string
  notes?: string
  title?: string
  description?: string
  location_text?: string
}

export interface TaskSchedule {
  id: string
  tenant_id: string
  title: string
  description?: string
  task_type: Exclude<TaskType, 'guest_request'>
  priority: Priority
  room_id?: string
  location_text?: string
  assigned_to?: string
  interval_type: 'daily' | 'weekly' | 'monthly' | 'custom'
  interval_days?: number
  next_due_at: string
  end_type: 'never' | 'count' | 'date'
  end_count?: number
  end_date?: string
  occurrences_generated: number
  is_active: boolean
  created_by: string
  created_at: string
}

export interface CreateTaskScheduleData {
  title: string
  description?: string
  task_type: Exclude<TaskType, 'guest_request'>
  priority: Priority
  room_id?: string
  location_text?: string
  assigned_to?: string
  interval_type: 'daily' | 'weekly' | 'monthly' | 'custom'
  interval_days?: number
  start_date: string
  end_type: 'never' | 'count' | 'date'
  end_count?: number
  end_date?: string
}

export interface TaskListFilters {
  status?: TaskStatus
  task_type?: TaskType
  priority?: Priority
  assigned_to?: string
  room_id?: string
  page?: number
  per_page?: number
}

export interface TaskWorkspace {
  active: { tasks: Task[]; guest_requests: import('./guest_requests').GuestRequest[] }
  history: { tasks: Task[]; guest_requests: import('./guest_requests').GuestRequest[] }
}

export interface TaskWorkspaceResponse {
  data: TaskWorkspace
  meta: { history_page: number; history_per_page: number }
}

export interface TaskWorkspaceParams {
  history_page?: number
  history_per_page?: number
  /** Server-side title/description(/guest_name) search — History only, since Active is always fetched in full. */
  history_search?: string
}

// ── API client ────────────────────────────────────────────────────────────────

export const tasksApi = {
  list: (filters?: TaskListFilters) =>
    apiClient.get('/tasks', { params: filters }),

  workspace: (params?: TaskWorkspaceParams) =>
    apiClient.get('/tasks/workspace', { params }) as Promise<TaskWorkspaceResponse>,

  get: (taskId: string) =>
    apiClient.get(`/tasks/${taskId}`),

  create: (data: CreateTaskData) =>
    apiClient.post('/tasks', data),

  update: (taskId: string, data: UpdateTaskData) =>
    apiClient.patch(`/tasks/${taskId}`, data),

  claim: (taskId: string) =>
    apiClient.post(`/tasks/${taskId}/claim`),

  addComment: (taskId: string, comment: string) =>
    apiClient.post(`/tasks/${taskId}/comments`, undefined, { params: { comment } }),

  delete: (taskId: string) =>
    apiClient.delete(`/tasks/${taskId}`),

  createSchedule: (data: CreateTaskScheduleData) =>
    apiClient.post('/tasks/schedules', data) as Promise<{ data: { schedule: TaskSchedule; task: Task | null } }>,

  deactivateSchedule: (scheduleId: string) =>
    apiClient.patch(`/tasks/schedules/${scheduleId}`, { is_active: false }) as Promise<{ data: TaskSchedule }>,
}
