import { format } from 'date-fns'
import { apiClient } from '@/lib/api/client'
import type { CleanType } from '@/lib/utils/cleanType'

export interface InspectionTemplateItem {
  id: string | null
  section: string
  description: string
  is_required: boolean
  sort_order: number
}

export interface InspectionTemplate {
  id: string | null
  name: string
  room_type_id: string | null
  is_default: boolean
  is_active: boolean
  items: InspectionTemplateItem[]
}

export interface SubmitInspectionPayload {
  room_id: string
  template_id: string | null
  overall_result: 'passed' | 'failed' | 'conditional'
  notes?: string
  items: {
    template_item_id: string | null
    result: 'pass' | 'fail' | 'na'
    note?: string
  }[]
}

export interface InspectionRecord {
  id: string
  room_number: string
  inspector_name: string
  overall_result: 'passed' | 'failed' | 'conditional'
  notes: string | null
  completed_at: string
}

export interface AssignmentPayload {
  date: string
  shift_id: string | null
  assignments: { room_id: string; housekeeper_id: string; clean_type?: CleanType }[]
  is_ai_suggested: boolean
}

export interface UpdateRoomStatusPayload {
  status: string
  notes?: string
}

export interface RoomPrediction {
  room_id: string
  housekeeper_id: string | null
  predicted_ready_at: string | null
  confidence_score: number | null
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null
  checkin_time: string | null
  minutes_to_checkin: number | null
  rooms_remaining_for_hk: number | null
  avg_speed_rooms_per_hr: number | null
  risk_factors: string[]
  last_calculated_at: string
  // enriched by board endpoint:
  room_number?: string
}

export const housekeepingApi = {
  getBoard: (date: string, shiftId?: string, includePredictions = true) =>
    apiClient.get('/housekeeping/board', {
      params: { date, shift_id: shiftId, include_predictions: includePredictions },
    }),

  getAssignments: (date: string, shiftId?: string) =>
    apiClient.get('/housekeeping/assignments', {
      params: { date: date || undefined, shift_id: shiftId },
    }),

  saveAssignments: (data: AssignmentPayload) =>
    apiClient.post('/housekeeping/assignments', data),

  deleteAssignment: (assignmentId: string) =>
    apiClient.delete(`/housekeeping/assignments/${assignmentId}`),

  aiSuggestAssignments: (date: string, shiftId?: string) =>
    apiClient.post(
      '/housekeeping/ai-suggest-assignments',
      {},
      { params: { date, shift_id: shiftId } },
    ),

  getPredictions: () => apiClient.get('/housekeeping/predictions'),

  submitInspection: (data: Record<string, unknown>) =>
    apiClient.post('/housekeeping/inspections', data),

  getInspectionTemplates: () =>
    apiClient.get('/housekeeping/inspections/templates'),

  getInspections: (params?: { date_from?: string; date_to?: string; room_id?: string; result?: string }) =>
    apiClient.get('/housekeeping/inspections', { params }),

  updateRoomStatus: (roomId: string, status: string, notes?: string) =>
    apiClient.patch(`/rooms/${roomId}/status`, { status, notes }),

  addNote: (roomId: string, text: string) =>
    apiClient.post(`/rooms/${roomId}/notes`, { text }),

  getRoomHistory: (roomId: string) =>
    apiClient.get(`/rooms/${roomId}/history`),

  getMyRooms: (date = format(new Date(), 'yyyy-MM-dd')) =>
    apiClient.get('/housekeeping/my-rooms', { params: { date } }),

  createInspectionTemplate: (data: {
    name: string
    is_default?: boolean
    items: Array<{ section: string; description: string; is_required: boolean }>
  }) => apiClient.post('/housekeeping/inspections/templates', data) as Promise<{ data: InspectionTemplate }>,

  updateInspectionTemplate: (id: string, data: {
    name?: string
    is_default?: boolean
    items?: Array<{ section: string; description: string; is_required: boolean }>
  }) => apiClient.patch(`/housekeeping/inspections/templates/${id}`, data) as Promise<{ data: InspectionTemplate }>,

  deleteInspectionTemplate: (id: string) =>
    apiClient.delete(`/housekeeping/inspections/templates/${id}`),
}
