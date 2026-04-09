import { apiClient } from '@/lib/api/client'

// ─── Entity interfaces ────────────────────────────────────────────────────────

export interface Shift {
  id: string
  tenant_id: string
  name: string
  department_id: string
  start_time: string  // "07:00:00"
  end_time: string    // "15:00:00"
  is_active: boolean
  created_at: string
}

export interface ShiftAssignment {
  id: string
  tenant_id: string
  user_id: string
  shift_id: string
  work_date: string   // "2026-03-06"
  is_on_shift: boolean
  clocked_in_at: string | null
  clocked_out_at: string | null
  created_at: string
  user_profiles?: { preferred_name: string | null; full_name: string }
  shifts?: { name: string; start_time: string; end_time: string }
}

export interface RosterEntry {
  user_id: string
  full_name: string
  role: string
  shift: { name: string; start_time: string; end_time: string }
  clocked_in_at: string | null
  is_on_shift: boolean
}

// ─── Request body interfaces ──────────────────────────────────────────────────

export interface CreateShiftData {
  name: string
  department_id: string
  start_time: string
  end_time: string
}

export interface UpdateShiftData {
  name?: string
  start_time?: string
  end_time?: string
  is_active?: boolean
}

export interface CreateAssignmentData {
  user_id: string
  shift_id: string
  work_date: string
}

export interface BulkAssignmentData {
  assignments: CreateAssignmentData[]
}

// ─── Response interfaces ──────────────────────────────────────────────────────

export interface ShiftListResponse {
  data: Shift[]
}

export interface ShiftResponse {
  data: {
    shift: Shift
  }
}

export interface AssignmentListResponse {
  data: ShiftAssignment[]
}

export interface AssignmentResponse {
  data: {
    assignment: ShiftAssignment
  }
}

export interface TodayRosterResponse {
  data: {
    roster: RosterEntry[]
    date: string
  }
}

// ─── API client ───────────────────────────────────────────────────────────────

export const schedulingApi = {
  // Shifts
  listShifts: (params?: { department_id?: string; is_active?: boolean }): Promise<ShiftListResponse> =>
    apiClient.get('/schedules/shifts', { params }),

  createShift: (data: CreateShiftData): Promise<ShiftResponse> =>
    apiClient.post('/schedules/shifts', data),

  updateShift: (id: string, data: UpdateShiftData): Promise<ShiftResponse> =>
    apiClient.patch(`/schedules/shifts/${id}`, data),

  deleteShift: (id: string): Promise<void> =>
    apiClient.delete(`/schedules/shifts/${id}`),

  // Assignments
  listAssignments: (params?: { work_date?: string; shift_id?: string; user_id?: string }): Promise<AssignmentListResponse> =>
    apiClient.get('/schedules/assignments', { params }),

  mySchedule: (params?: { date_from?: string; date_to?: string }): Promise<AssignmentListResponse> =>
    apiClient.get('/schedules/assignments/my-schedule', { params }),

  createAssignment: (data: CreateAssignmentData): Promise<AssignmentResponse> =>
    apiClient.post('/schedules/assignments', data),

  bulkUpsertAssignments: (data: BulkAssignmentData): Promise<AssignmentListResponse> =>
    apiClient.post('/schedules/assignments/bulk', data),

  deleteAssignment: (id: string): Promise<void> =>
    apiClient.delete(`/schedules/assignments/${id}`),

  clockIn: (id: string): Promise<AssignmentResponse> =>
    apiClient.patch(`/schedules/assignments/${id}/clock-in`),

  clockOut: (id: string): Promise<AssignmentResponse> =>
    apiClient.patch(`/schedules/assignments/${id}/clock-out`),

  // Roster
  todayRoster: (): Promise<TodayRosterResponse> =>
    apiClient.get('/schedules/today-roster'),
}
