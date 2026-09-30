import { apiClient } from '@/lib/api/client'

export type LogbookCategory = 'guest' | 'room' | 'maintenance' | 'safety' | 'general'
export type LogbookStatus = 'informational' | 'follow_up' | 'resolved'
export type LogbookPriority = 'normal' | 'important'
export type LogbookRelatedType = 'room' | 'task' | 'work_order' | 'guest_request'

export interface LogbookEntry {
  id: string
  department_id: string
  shift_id?: string
  entry_date: string
  content: string
  category: LogbookCategory
  status: LogbookStatus
  priority: LogbookPriority
  follow_up_at?: string | null
  assigned_to?: string | null
  related_type?: LogbookRelatedType | null
  related_id?: string | null
  resolved_at?: string | null
  resolved_by?: string | null
  resolution_note?: string | null
  edited_at?: string | null
  archived_at?: string | null
  carried_from_entry_id?: string | null
  carried_forward_at?: string | null
  carried_forward_by?: string | null
  is_ai_generated: boolean
  author_id: string
  expires_at?: string | null
  created_at: string
  // Joined
  user_profiles?: { preferred_name?: string; full_name?: string }
  assigned_user_profiles?: { preferred_name?: string; full_name?: string }
  resolved_by_profile?: { preferred_name?: string; full_name?: string }
  departments?: { name: string }
  comment_count?: number
  read_count?: number
  attachment_count?: number
  requires_acknowledgment?: boolean
  acknowledgment_version?: number
  acknowledgment?: { required: boolean; total_required: number; acknowledged_count: number; current_user_required: boolean; current_user_acknowledged: boolean }
}

export interface LogbookAttachment {
  id: string
  label: string
  file_name: string | null
  file_content_type: string | null
  evidence_type: 'file' | 'photo'
  collected_at: string | null
  collector_name: string | null
}

export interface LogbookTranslation {
  translated_text: string
  source_language: 'en' | 'es' | null
  cached: boolean
}

export interface LogbookComment {
  id: string
  entry_id: string
  author_id: string
  content: string
  created_at: string
  edited_at?: string | null
  author: { id: string; preferred_name?: string | null; full_name?: string | null }
}

export interface LogbookEntryRead { user_id: string; name: string; first_read_at: string; last_read_at: string }

export type LogbookEventType = 'created' | 'edited' | 'carried_forward' | 'resolved' | 'archived' | 'reopened'

export interface LogbookEntryEvent {
  id: string
  entry_id: string
  event_type: LogbookEventType
  actor_id: string | null
  actor_name: string | null
  created_at: string
  metadata: Record<string, unknown>
}

export interface LogbookContinuityLink {
  id: string
  shift_id: string | null
  shift_name: string | null
  entry_date: string
  created_at: string
  status: LogbookStatus
  resolved_at: string | null
  author?: { preferred_name?: string; full_name?: string }
}

export interface CreateLogbookEntryPayload {
  department_id: string
  shift_id?: string
  content: string
  category?: LogbookCategory
  priority?: LogbookPriority
  status?: Extract<LogbookStatus, 'informational' | 'follow_up'>
  follow_up_at?: string
  assigned_to?: string
  related_type?: LogbookRelatedType
  related_id?: string
  expires_hours?: number
  requires_acknowledgment?: boolean
  acknowledgment_target_ids?: string[]
}

export interface UpdateLogbookEntryPayload {
  content?: string
  category?: LogbookCategory
  priority?: LogbookPriority
  status?: LogbookStatus
  follow_up_at?: string | null
  assigned_to?: string | null
  related_type?: LogbookRelatedType | null
  related_id?: string | null
  expires_hours?: number
  requires_acknowledgment?: boolean
  acknowledgment_target_ids?: string[]
}

export interface Department {
  id: string
  name: string
  code: string
}

export interface LogbookPaginationMeta {
  page: number
  per_page: number
  total: number
  has_more: boolean
}

export interface LogbookEntryListParams {
  q?: string
  department_id?: string
  shift_id?: string
  entry_date?: string
  date_from?: string
  date_to?: string
  category?: LogbookCategory
  status?: LogbookStatus
  priority?: LogbookPriority
  author_id?: string
  /** `__unassigned__` is the API's explicit historical-follow-up sentinel. */
  assigned_to?: string
  related_type?: LogbookRelatedType
  page?: number
  per_page?: number
}

export interface ShiftSummaryStats {
  tasks_completed: number
  open_work_orders: number
  logbook_entries_count: number
  vip_arrivals_count: number
  pending_guest_issues_count: number
  low_stock_parts_count: number
  sla_breaches_count: number
  follow_up_count?: number
  model_used?: string
}

export interface ShiftHandoffTask {
  id: string
  title: string
  task_type?: string | null
  completed_at?: string | null
}

export interface ShiftHandoffWorkOrder {
  id: string
  title: string
  room_number?: string | null
  status?: string | null
  priority?: string | null
  due_at?: string | null
}

export interface ShiftHandoffGuestIssue {
  id: string
  title: string
  room_number?: string | null
  status?: string | null
  due_at?: string | null
}

export interface ShiftHandoffVipItem {
  room_id: string
  room_number: string
}

export interface ShiftHandoffLowStockPart {
  id: string
  name: string
  quantity_on_hand: number
  minimum_stock: number
}

export interface ShiftHandoffSlaBreach {
  type: 'work_order' | 'task'
  id: string
  title: string
  due_at?: string | null
  overdue_minutes?: number | null
}

export interface ShiftHandoffFollowUp {
  logbook_entry_id: string
  content: string
  priority?: LogbookPriority | null
  assigned_to_name?: string | null
  assigned_to?: string | null
  follow_up_at?: string | null
  related_type?: LogbookRelatedType | null
  related_id?: string | null
}

export interface ShiftHandoffData {
  logbook?: { entry_count: number; follow_up_count: number }
  tasks_completed?: ShiftHandoffTask[]
  open_work_orders?: ShiftHandoffWorkOrder[]
  guest_issues?: ShiftHandoffGuestIssue[]
  vip_arrivals?: ShiftHandoffVipItem[]
  low_stock_parts?: ShiftHandoffLowStockPart[]
  sla_breaches?: ShiftHandoffSlaBreach[]
  follow_ups?: ShiftHandoffFollowUp[]
}

export interface ShiftSummary {
  id: string
  shift_id: string
  shift_date: string
  department_id?: string | null
  summary_text: string
  stats: ShiftSummaryStats
  handoff_data?: ShiftHandoffData | null
  generated_at?: string | null
  updated_at?: string | null
  generated_by_ai?: boolean
  // Legacy dashboard callers still consume these flattened values. New UI reads
  // the canonical `stats` object above.
  tasks_completed?: number
  open_work_orders?: number
  logbook_entries_count?: number
  vip_arrivals_count?: number
  pending_guest_issues_count?: number
  low_stock_parts_count?: number
  sla_breaches_count?: number
  acknowledged_by?: string | null
  acknowledged_at?: string | null
  acknowledged_by_name?: string | null
}

export const logbookApi = {
  listEntries: (params?: LogbookEntryListParams) =>
    apiClient.get('/logbook/entries', { params }) as Promise<{
      data: LogbookEntry[]
      meta: LogbookPaginationMeta
    }>,

  getEntry: (id: string) =>
    apiClient.get(`/logbook/entries/${id}`) as Promise<{ data: LogbookEntry }>,

  createEntry: (payload: CreateLogbookEntryPayload) =>
    apiClient.post('/logbook/entries', payload) as Promise<{ data: LogbookEntry }>,

  updateEntry: (id: string, payload: UpdateLogbookEntryPayload) =>
    apiClient.patch(`/logbook/entries/${id}`, payload) as Promise<{ data: LogbookEntry }>,

  deleteEntry: (id: string) =>
    apiClient.delete(`/logbook/entries/${id}`) as Promise<void>,

  resolveEntry: (id: string, payload: { resolution_note?: string }) =>
    apiClient.post(`/logbook/entries/${id}/resolve`, payload) as Promise<{ data: LogbookEntry & { already_resolved?: boolean } }>,

  archiveEntry: (id: string) =>
    apiClient.post(`/logbook/entries/${id}/archive`, {}) as Promise<{ data: { id: string; archived_at: string; already_archived?: boolean } }>,

  carryForwardEntry: (id: string, payload: { assigned_to?: string }) =>
    apiClient.post(`/logbook/entries/${id}/carry-forward`, payload) as Promise<{ data: LogbookEntry }>,

  getContinuity: (id: string) =>
    apiClient.get(`/logbook/entries/${id}/continuity`) as Promise<{ data: LogbookContinuityLink[] }>,

  getEvents: (id: string) =>
    apiClient.get(`/logbook/entries/${id}/events`) as Promise<{ data: LogbookEntryEvent[] }>,

  listComments: (id: string) => apiClient.get(`/logbook/entries/${id}/comments`) as Promise<{ data: LogbookComment[] }>,
  createComment: (id: string, payload: { content: string; mentioned_user_ids: string[] }) => apiClient.post(`/logbook/entries/${id}/comments`, payload) as Promise<{ data: LogbookComment }>,
  updateComment: (id: string, payload: { content: string; mentioned_user_ids: string[] }) => apiClient.patch(`/logbook/comments/${id}`, payload) as Promise<{ data: LogbookComment }>,
  deleteComment: (id: string) => apiClient.delete(`/logbook/comments/${id}`) as Promise<{ data: { success: boolean } }>,
  markEntryRead: (id: string) => apiClient.post(`/logbook/entries/${id}/read`, {}) as Promise<{ data: LogbookEntryRead }>,
  listEntryReads: (id: string) => apiClient.get(`/logbook/entries/${id}/reads`) as Promise<{ data: LogbookEntryRead[] }>,
  acknowledgeEntry: (id: string) => apiClient.post(`/logbook/entries/${id}/acknowledge`, {}) as Promise<{ data: { success: boolean; version: number } }>,
  remindAcknowledgmentTargets: (id: string) => apiClient.post(`/logbook/entries/${id}/acknowledgment-reminder`, {}) as Promise<{ data: { sent: number; rate_limited: boolean } }>,
  listAttachments: (id: string) => apiClient.get(`/logbook/entries/${id}/attachments`) as Promise<{ data: LogbookAttachment[] }>,
  removeAttachment: (id: string, attachmentId: string) => apiClient.delete(`/logbook/entries/${id}/attachments/${attachmentId}`) as Promise<void>,
  translateEntry: (id: string, payload: { target_language: 'en' | 'es'; source_field?: 'content' | 'resolution_note' }) => apiClient.post(`/logbook/entries/${id}/translate`, payload) as Promise<{ data: LogbookTranslation }>,
  translateComment: (id: string, targetLanguage: 'en' | 'es') => apiClient.post(`/logbook/comments/${id}/translate`, { target_language: targetLanguage }) as Promise<{ data: LogbookTranslation }>,

  listDepartments: (hotelId: string) =>
    apiClient.get(`/hotels/${hotelId}/departments`) as Promise<{ data: Department[] }>,

  generateShiftSummary: (payload: { shift_id?: string; shift_date: string; regenerate?: boolean }) =>
    apiClient.post('/logbook/shift-summary/generate', payload) as Promise<{ data: ShiftSummary }>,

  getShiftSummary: (shiftId: string, shiftDate?: string) =>
    apiClient.get(`/logbook/shift-summary/${shiftId}`, { params: shiftDate ? { shift_date: shiftDate } : undefined }) as Promise<{ data: ShiftSummary }>,

  // Looks up the summary for whichever shift most recently ended on the given date,
  // without generating one — lets the UI show an already-generated summary (cron or
  // an earlier manual click) on open, instead of only after a fresh in-session generate.
  getCurrentShiftSummary: (shiftDate: string) =>
    apiClient.get('/logbook/shift-summary', { params: { shift_date: shiftDate } }) as Promise<{ data: ShiftSummary }>,

  acknowledgeShiftSummary: (summaryId: string) =>
    apiClient.post(`/logbook/shift-summary/${summaryId}/acknowledge`, {}) as Promise<{
      data: {
        id: string
        acknowledged_by: string
        acknowledged_at: string
        acknowledged_by_name: string | null
      }
    }>,
}
