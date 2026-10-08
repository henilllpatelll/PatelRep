import { apiClient } from '@/lib/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomStatus {
  room_id: string
  tenant_id: string
  status: 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'
  assigned_to: string | null
  guest_name: string | null
  vip_flag: boolean
  checkin_time: string | null
  checkout_time: string | null
  actual_checkout_at: string | null
  fo_status: 'OCC' | 'VAC' | null
  dnd_flag: boolean
  priority: number
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null
  predicted_ready_at: string | null
  last_cleaned_at: string | null
  last_inspected_at: string | null
  notes: string | null
  updated_at: string
  // Joined
  rooms?: {
    id: string
    room_number: string
    floor: number
    building?: string
    room_types?: { name: string; code: string; base_clean_minutes: number }
  }
  user_profiles?: { preferred_name: string; full_name: string }
  prediction?: {
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null
    predicted_ready_at: string | null
    risk_factors: string[]
  }
}

export interface RoomStatusHistoryEntry {
  id: string
  room_id: string
  from_status: string | null
  to_status: string
  changed_by: string | null
  change_source: string
  notes: string | null
  created_at: string
}

export interface ImportRoomPayload {
  room_number: string
  floor: number
  room_type_code: string
  room_type_name?: string
  building?: string
}

/** Shape returned by POST /rooms/import (inside `data`). `reset_count` = existing rooms whose status was reset. */
export interface ImportResult {
  imported_count: number
  reset_count: number
  errors: { room_number: string | null; reason: string }[]
}

export interface RoomType { id: string; code: string; name: string }

export interface CreateRoomPayload {
  room_number: string
  floor: number
  room_type_id: string
  building?: string
}

export type UpdateRoomDetailsPayload = Partial<CreateRoomPayload>

export interface RoomDeletionCheck { room_number: string; can_delete: boolean; blocked_by: string[] }

export interface RoomUnavailabilityPeriod {
  id: string
  room_id: string
  status: 'ACTIVE' | 'RELEASED' | 'CANCELLED'
  type: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'
  reason_code: string
  reason_label: string
  details?: string | null
  expected_return_at?: string | null
  actual_return_at?: string | null
  started_at: string
  release_notes?: string | null
  owner_id?: string | null
  is_past_eta: boolean
  rooms?: { room_number: string; floor?: number; room_types?: { name: string; code: string } | null }
  work_orders?: {
    id: string
    work_order_number: number
    title: string
    priority: 'emergency' | 'urgent' | 'normal' | 'low'
    status: 'open' | 'escalated' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
    assigned_to: string | null
    created_at: string
  } | null
  room_unavailability_events?: {
    id: string
    event_type: string
    old_expected_return_at?: string | null
    new_expected_return_at?: string | null
    note?: string | null
    actor_id?: string | null
    created_at: string
  }[]
}

export interface RoomUnavailabilityReason { id: string; code: string; label: string }

// ─── API Client ───────────────────────────────────────────────────────────────

export const roomsApi = {
  list: (filters?: {
    status?: string
    floor?: number
    assigned_to?: string
    risk_level?: string
  }) => apiClient.get('/rooms', { params: filters }),

  get: (roomId: string) => apiClient.get(`/rooms/${roomId}`),

  updateStatus: (roomId: string, status: string, notes?: string, force?: boolean) =>
    apiClient.patch(`/rooms/${roomId}/status`, { status, notes, force }),

  getHistory: (roomId: string) =>
    apiClient.get(`/rooms/${roomId}/history`),

  markStayover: (roomId: string) =>
    apiClient.post(`/rooms/${roomId}/stayover`, {}),

  deleteRoom: (roomId: string) =>
    apiClient.delete(`/rooms/${roomId}`),

  importRooms: (rooms: ImportRoomPayload[], source: 'csv' | 'manual' = 'manual') =>
    apiClient.post('/rooms/import', { source, rooms }) as Promise<{ data: ImportResult }>,

  listTypes: () => apiClient.get('/rooms/types') as Promise<{ data: RoomType[] }>,

  createRoom: (payload: CreateRoomPayload) => apiClient.post('/rooms', payload),

  updateRoomDetails: (roomId: string, payload: UpdateRoomDetailsPayload) =>
    apiClient.patch(`/rooms/${roomId}/details`, payload),

  checkDeletion: (roomId: string) =>
    apiClient.get(`/rooms/${roomId}/deletion-check`) as Promise<{ data: RoomDeletionCheck }>,
}

export const roomUnavailabilityApi = {
  list: (status?: 'ACTIVE' | 'RELEASED' | 'CANCELLED', filters?: { room_id?: string; returned_today?: boolean }) =>
    apiClient.get('/room-unavailability', { params: { ...(status ? { status } : {}), ...filters } }) as Promise<{ data: RoomUnavailabilityPeriod[] }>,
  summary: () => apiClient.get('/room-unavailability/summary') as Promise<{ data: { active: number; past_eta: number } }>,
  reasons: () => apiClient.get('/room-unavailability/reasons') as Promise<{ data: RoomUnavailabilityReason[] }>,
  get: (id: string) => apiClient.get(`/room-unavailability/${id}`) as Promise<{ data: RoomUnavailabilityPeriod }>,
  getActiveForRoom: (roomId: string) => apiClient.get(`/room-unavailability/room/${roomId}/active`) as Promise<{ data: RoomUnavailabilityPeriod | null }>,
  create: (payload: { room_id: string; type?: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'; reason_code: string; reason_label: string; expected_return_at: string; details?: string; primary_work_order_id?: string }) =>
    apiClient.post('/room-unavailability', payload) as Promise<{ data: { period: RoomUnavailabilityPeriod } }>,
  updateEta: (id: string, expected_return_at: string, note?: string) =>
    apiClient.patch(`/room-unavailability/${id}/expected-return`, { expected_return_at, note }) as Promise<{ data: RoomUnavailabilityPeriod }>,
  release: (id: string, release_notes?: string) =>
    apiClient.post(`/room-unavailability/${id}/release`, { release_notes }) as Promise<{ data: { period: RoomUnavailabilityPeriod } }>,
}
