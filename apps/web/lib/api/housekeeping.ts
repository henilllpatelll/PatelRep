import { format } from 'date-fns'
import { apiClient } from '@/lib/api/client'
import type { CleanType } from '@/lib/utils/cleanType'

export interface InspectionTemplateItem {
  id: string | null
  section: string
  description: string
  is_required: boolean
  requires_photo_on_fail: boolean
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

export interface ReadyForInspectionRoom {
  room_id: string
  room_number: string
  floor: number | null
  cleaned_by: string
  cleaned_at: string | null
  housekeeper_id: string | null
  clean_type: string | null
}

export interface ReadyToStripRoom {
  room_id: string
  room_number: string
  floor: number | null
  checkout_time: string | null
  fo_status: string | null
  assigned_housekeeper_id: string | null
}

export interface AssignmentPayload {
  date: string
  shift_id: string | null
  assignments: { room_id: string; housekeeper_id: string; clean_type?: CleanType; sequence_order?: number }[]
  is_ai_suggested: boolean
}

export interface SuggestedRoom {
  room_id: string
  room_number: string
  floor: number | null
  building: string | null
  status: string
  room_type: string
  base_clean_minutes: number
  is_vip: boolean
  sequence: number
}

export interface AssignmentSuggestion {
  housekeeper: {
    id: string
    full_name: string
    preferred_name: string
    building_affinity: string | null
  }
  rooms: SuggestedRoom[]
  room_count: number
  total_minutes: number
}

export interface AiSuggestAssignmentsResponse {
  data: {
    suggestions: AssignmentSuggestion[]
    date?: string
    shift_id?: string | null
    blocked_rooms?: number
    excluded_staff?: Array<{ id: string; reason: 'on_break' | 'off_shift' | 'unavailable' }>
    message: string
  }
}

export interface UpdateRoomStatusPayload {
  status: string
  notes?: string
}

export interface ManualCheckoutPayload {
  checkout_time?: string
  actual_checkout_at?: string
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
  is_acknowledged?: boolean
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  // enriched by board endpoint:
  room_number?: string
}

export type BatchRoomActionError = { room_id: string; action: 'error'; status: number; detail: string }

export type BatchReassignResult =
  | { room_id: string; action: 'reassigned'; housekeeper_id: string }
  | { room_id: string; action: 'escalated'; reason: 'no_eligible_housekeeper' }
  | BatchRoomActionError

export type BatchAcknowledgeResult =
  | { room_id: string; action: 'acknowledged' }
  | { room_id: string; action: 'already_acknowledged' }
  | BatchRoomActionError

export interface HotelAvgCleanTime {
  today_avg_minutes: number | null
  seven_day_avg_minutes: number | null
  delta_minutes: number | null
  today_count: number
}

export type PriorityReason = 'early_arrival' | 'vip' | 'guest_waiting' | 'front_desk_request' | 'operational_priority' | 'other'

export interface SetRoomPriorityPayload {
  priority_state: 'normal' | 'rush'
  reason?: PriorityReason
  needed_by?: string
  note?: string
}

export type ServiceAttemptResult = 'dnd_no_response' | 'return_later' | 'guest_answered' | 'dnd_cleared' | 'other'

export interface RecordServiceAttemptPayload {
  result: ServiceAttemptResult
  attempted_at?: string
  return_at?: string
  note?: string
}

export interface ServiceAttempt {
  id: string
  room_id: string
  result: ServiceAttemptResult
  attempted_at: string
  return_at: string | null
  note: string | null
  recorded_by: string | null
  created_at: string
}

export type ServiceDeclinedReason = 'guest_declined_housekeeping' | 'guest_no_service_today' | 'privacy_request' | 'other'

export interface ServiceDeclinedPayload {
  reason: ServiceDeclinedReason
  note?: string
}

export type OccupancyObservation = 'occupied' | 'vacant'
export type DiscrepancyResolution = 'pms_confirmed' | 'housekeeping_confirmed' | 'guest_record_corrected' | 'false_alarm' | 'escalated'

export interface ReportDiscrepancyPayload {
  housekeeping_observed: OccupancyObservation
  note?: string
}

export interface ResolveDiscrepancyPayload {
  resolution: DiscrepancyResolution
  note?: string
}

export interface OccupancyDiscrepancy {
  id: string
  room_id: string
  housekeeping_observed: OccupancyObservation
  pms_status_at_report: string | null
  note: string | null
  reported_by: string
  reported_at: string
  status: 'open' | 'resolved'
  resolution: DiscrepancyResolution | null
  resolution_note: string | null
  resolved_by: string | null
  resolved_at: string | null
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

  /** Hotel-wide average clean time for today plus the 7-day trend (dashboard hero). */
  getHotelAvgCleanTime: (): Promise<{ data: HotelAvgCleanTime }> =>
    apiClient.get('/clean-sessions/hotel-avg-clean-time'),

  saveAssignments: (data: AssignmentPayload) =>
    apiClient.post('/housekeeping/assignments', data),

  deleteAssignment: (assignmentId: string) =>
    apiClient.delete(`/housekeeping/assignments/${assignmentId}`),

  /**
   * Clears a room's assigned_to when the board is showing it via the
   * room_status mirror fallback (no room_assignments row for today, so
   * there's no assignment id to pass to deleteAssignment).
   */
  removeRoomAssignmentMirror: (roomId: string) =>
    apiClient.delete(`/housekeeping/room-assignment/${roomId}`),

  aiSuggestAssignments: (date: string, shiftId?: string) =>
    apiClient.post(
      '/housekeeping/ai-suggest-assignments',
      {},
      { params: { date, shift_id: shiftId } },
    ) as Promise<AiSuggestAssignmentsResponse>,

  getPredictions: () => apiClient.get('/housekeeping/predictions'),

  reassignAtRiskRoom: (roomId: string) =>
    apiClient.post(`/housekeeping/room-readiness/${roomId}/reassign`) as Promise<{
      data:
        | { action: 'reassigned'; housekeeper_id: string }
        | { action: 'escalated'; reason: 'no_eligible_housekeeper' }
    }>,

  escalateAtRiskRoom: (roomId: string) =>
    apiClient.post(`/housekeeping/room-readiness/${roomId}/escalate`) as Promise<{
      data: { action: 'escalated'; notifications_sent: number }
    }>,

  acknowledgeAtRiskRoom: (roomId: string) =>
    apiClient.post(`/housekeeping/room-readiness/${roomId}/acknowledge`) as Promise<{
      data: { action: 'acknowledged' | 'already_acknowledged' }
    }>,

  batchReassignAtRiskRooms: (roomIds: string[]) =>
    apiClient.post('/housekeeping/room-readiness/batch-reassign', { room_ids: roomIds }) as Promise<{
      data: {
        results: BatchReassignResult[]
        succeeded: number
        failed: number
      }
    }>,

  batchAcknowledgeAtRiskRooms: (roomIds: string[]) =>
    apiClient.post('/housekeeping/room-readiness/batch-acknowledge', { room_ids: roomIds }) as Promise<{
      data: {
        results: BatchAcknowledgeResult[]
        succeeded: number
        failed: number
      }
    }>,

  submitInspection: (data: SubmitInspectionPayload) =>
    apiClient.post('/housekeeping/inspections', data) as Promise<{ data: { id: string } }>,

  triggerReclean: (inspectionId: string) =>
    apiClient.post(`/housekeeping/inspections/${inspectionId}/reclean`, {}) as Promise<{
      data: { room_id: string; task: { id: string; title: string } | null }
    }>,

  uploadInspectionPhoto: (inspectionId: string, templateItemId: string, file: File) => {
    const form = new FormData()
    form.append('template_item_id', templateItemId)
    form.append('photo', file)
    return apiClient.post(`/housekeeping/inspections/${inspectionId}/photos`, form) as Promise<{
      data: { url: string; template_item_id: string }
    }>
  },

  completeInspection: (data: SubmitInspectionPayload, photos: Record<string, File>) => {
    const form = new FormData()
    form.append('inspection', JSON.stringify(data))
    for (const [templateItemId, photo] of Object.entries(photos)) {
      form.append('photo_item_ids', templateItemId)
      form.append('photos', photo)
    }
    return apiClient.post('/housekeeping/inspections/complete', form) as Promise<{
      data: { id: string; overall_result: 'passed' | 'failed'; reclean_requested: boolean }
    }>
  },

  getInspectionTemplates: () =>
    apiClient.get('/housekeeping/inspections/templates'),

  getInspections: (params?: { date_from?: string; date_to?: string; room_id?: string; result?: string }) =>
    apiClient.get('/housekeeping/inspections', { params }),

  getReadyForInspection: (date?: string) =>
    apiClient.get('/housekeeping/ready-for-inspection', { params: date ? { date } : undefined }),

  getReadyToStrip: (date?: string) =>
    apiClient.get('/housekeeping/ready-to-strip', { params: date ? { date } : undefined }),

  markRoomStripped: (roomId: string) =>
    apiClient.post(`/rooms/${roomId}/strip`, {}),

  updateRoomStatus: (roomId: string, status: string, notes?: string) =>
    apiClient.patch(`/rooms/${roomId}/status`, { status, notes }),

  markCheckedOut: (roomId: string, data?: ManualCheckoutPayload) =>
    apiClient.post(`/rooms/${roomId}/checkout`, data ?? {}),

  undoCheckout: (roomId: string) =>
    apiClient.delete(`/rooms/${roomId}/checkout`),

  markCheckIn: (roomId: string) =>
    apiClient.post(`/rooms/${roomId}/checkin`, {}),

  requestWelfareCheck: (roomId: string) =>
    apiClient.post(`/rooms/${roomId}/welfare-check`, {}),

  sendReClean: (roomId: string, note?: string, reassignTo?: string) =>
    apiClient.post(`/rooms/${roomId}/re-clean`, { note, reassign_to: reassignTo }),

  updateCheckoutTime: (roomId: string, checkoutTime: string) =>
    apiClient.patch(`/rooms/${roomId}/checkout-time`, { checkout_time: checkoutTime }),

  undoRoomStatus: (roomId: string, notes?: string) =>
    apiClient.post(`/rooms/${roomId}/status/undo`, notes ? { notes } : {}),

  addNote: (roomId: string, text: string) =>
    apiClient.post(`/rooms/${roomId}/notes`, { text }),

  getRoomHistory: (roomId: string, limit = 50) =>
    apiClient.get(`/rooms/${roomId}/history`, { params: { limit } }),

  getMyRooms: (date = format(new Date(), 'yyyy-MM-dd')) =>
    apiClient.get('/housekeeping/my-rooms', { params: { date } }),

  createInspectionTemplate: (data: {
    name: string
    is_default?: boolean
    items: Array<{ section: string; description: string; is_required: boolean; requires_photo_on_fail?: boolean }>
  }) => apiClient.post('/housekeeping/inspections/templates', data) as Promise<{ data: InspectionTemplate }>,

  updateInspectionTemplate: (id: string, data: {
    name?: string
    is_default?: boolean
    items?: Array<{ section: string; description: string; is_required: boolean; requires_photo_on_fail?: boolean }>
  }) => apiClient.patch(`/housekeeping/inspections/templates/${id}`, data) as Promise<{ data: InspectionTemplate }>,

  deleteInspectionTemplate: (id: string) =>
    apiClient.delete(`/housekeeping/inspections/templates/${id}`),

  importHKDetails: (file: File, assignmentDate: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('assignment_date', assignmentDate)
    return apiClient.post('/housekeeping/import/hk-details', form)
  },

  previewHKDetails: (file: File, assignmentDate: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('assignment_date', assignmentDate)
    return apiClient.post('/housekeeping/import/hk-details/preview', form)
  },

  importTaskSheet: (file: File, assignmentDate: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('assignment_date', assignmentDate)
    return apiClient.post('/housekeeping/import/task-sheet', form)
  },

  previewTaskSheet: (file: File, assignmentDate: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('assignment_date', assignmentDate)
    return apiClient.post('/housekeeping/import/task-sheet/preview', form)
  },

  // Phase 8: Rush/priority, DND attempts, service declined, occupancy discrepancy
  setRoomPriority: (roomId: string, data: SetRoomPriorityPayload) =>
    apiClient.patch(`/rooms/${roomId}/priority`, data),

  recordServiceAttempt: (roomId: string, data: RecordServiceAttemptPayload) =>
    apiClient.post(`/rooms/${roomId}/service-attempts`, data) as Promise<{ data: ServiceAttempt }>,

  getServiceAttempts: (roomId: string, limit = 20) =>
    apiClient.get(`/rooms/${roomId}/service-attempts`, { params: { limit } }) as Promise<{ data: ServiceAttempt[] }>,

  setServiceDeclined: (roomId: string, data: ServiceDeclinedPayload) =>
    apiClient.post(`/rooms/${roomId}/service-declined`, data),

  reportDiscrepancy: (roomId: string, data: ReportDiscrepancyPayload) =>
    apiClient.post(`/rooms/${roomId}/discrepancies`, data) as Promise<{ data: OccupancyDiscrepancy }>,

  getRoomDiscrepancies: (roomId: string) =>
    apiClient.get(`/rooms/${roomId}/discrepancies`) as Promise<{ data: OccupancyDiscrepancy[] }>,

  resolveDiscrepancy: (discrepancyId: string, data: ResolveDiscrepancyPayload) =>
    apiClient.post(`/rooms/discrepancies/${discrepancyId}/resolve`, data) as Promise<{ data: OccupancyDiscrepancy }>,
}
