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

export interface ImportResult {
  imported: number
  skipped: number
  errors?: { room_number: string; reason: string }[]
}

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
  is_past_eta: boolean
  rooms?: { room_number: string; floor?: number }
  work_orders?: { work_order_number: number; title: string } | null
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

  importRooms: (rooms: ImportRoomPayload[]) =>
    apiClient.post('/rooms/import', { source: 'manual', rooms }),

  importFromCSV: (csvContent: string): Promise<ImportResult> => {
    // Parse CSV lines into room objects and call importRooms
    // Expected CSV format: room_number,floor,room_type_code,room_type_name
    const lines = csvContent.trim().split('\n')
    if (lines.length < 2) {
      return Promise.reject(new Error('CSV must have a header row and at least one data row'))
    }
    const headers = lines[0].toLowerCase().split(',').map((h) => h.trim())
    const rooms: ImportRoomPayload[] = lines
      .slice(1)
      .map((line) => {
        const values = line.split(',').map((v) => v.trim())
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => {
          obj[h] = values[i] ?? ''
        })
        return {
          room_number: obj['room_number'] || obj['room number'] || '',
          floor: parseInt(obj['floor'] || '1', 10),
          room_type_code: (obj['room_type_code'] || obj['type'] || 'SD').toUpperCase(),
          room_type_name: obj['room_type_name'] || obj['type_name'] || undefined,
          building: obj['building'] || undefined,
        }
      })
      .filter((r) => Boolean(r.room_number))
    return apiClient.post('/rooms/import', { source: 'csv', rooms })
  },

  /** Parse CSV text into a preview array — no network call — for pre-submit previews */
  parseCSVPreview: (csvContent: string): ImportRoomPayload[] => {
    const lines = csvContent.trim().split('\n')
    if (lines.length < 2) return []
    const headers = lines[0].toLowerCase().split(',').map((h) => h.trim())
    return lines
      .slice(1)
      .map((line) => {
        const values = line.split(',').map((v) => v.trim())
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => {
          obj[h] = values[i] ?? ''
        })
        return {
          room_number: obj['room_number'] || obj['room number'] || '',
          floor: parseInt(obj['floor'] || '1', 10),
          room_type_code: (obj['room_type_code'] || obj['type'] || 'SD').toUpperCase(),
          room_type_name: obj['room_type_name'] || obj['type_name'] || undefined,
          building: obj['building'] || undefined,
        }
      })
      .filter((r) => Boolean(r.room_number))
  },
}

export const roomUnavailabilityApi = {
  list: (status?: 'ACTIVE' | 'RELEASED' | 'CANCELLED') =>
    apiClient.get('/room-unavailability', { params: status ? { status } : undefined }) as Promise<{ data: RoomUnavailabilityPeriod[] }>,
  summary: () => apiClient.get('/room-unavailability/summary') as Promise<{ data: { active: number; past_eta: number } }>,
  reasons: () => apiClient.get('/room-unavailability/reasons') as Promise<{ data: RoomUnavailabilityReason[] }>,
  get: (id: string) => apiClient.get(`/room-unavailability/${id}`) as Promise<{ data: RoomUnavailabilityPeriod }>,
  getActiveForRoom: (roomId: string) => apiClient.get(`/room-unavailability/room/${roomId}/active`) as Promise<{ data: RoomUnavailabilityPeriod | null }>,
  create: (payload: { room_id: string; reason_code: string; reason_label: string; expected_return_at: string; details?: string }) =>
    apiClient.post('/room-unavailability', payload) as Promise<{ data: { period: RoomUnavailabilityPeriod } }>,
  updateEta: (id: string, expected_return_at: string, note?: string) =>
    apiClient.patch(`/room-unavailability/${id}/expected-return`, { expected_return_at, note }) as Promise<{ data: RoomUnavailabilityPeriod }>,
  release: (id: string, release_notes?: string) =>
    apiClient.post(`/room-unavailability/${id}/release`, { release_notes }) as Promise<{ data: { period: RoomUnavailabilityPeriod } }>,
}
