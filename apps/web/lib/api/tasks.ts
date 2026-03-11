import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
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
  created_by: string
  is_ai_created: boolean
  ai_confidence?: number
  sla_minutes: number
  due_at?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
  // Joined relations
  rooms?: { room_number: string; floor?: number }
  user_profiles?: { preferred_name: string }
  task_comments?: TaskComment[]
}

export interface TaskComment {
  id: string
  task_id: string
  user_id: string
  comment: string
  is_system: boolean
  created_at: string
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
  priority?: Priority
  assigned_to?: string
  notes?: string
  title?: string
  description?: string
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

// ── API client ────────────────────────────────────────────────────────────────

export const tasksApi = {
  list: (filters?: TaskListFilters) =>
    apiClient.get('/tasks', { params: filters }),

  get: (taskId: string) =>
    apiClient.get(`/tasks/${taskId}`),

  create: (data: CreateTaskData) =>
    apiClient.post('/tasks', data),

  update: (taskId: string, data: UpdateTaskData) =>
    apiClient.patch(`/tasks/${taskId}`, data),

  addComment: (taskId: string, comment: string) =>
    apiClient.post(`/tasks/${taskId}/comments`, undefined, { params: { comment } }),
}
