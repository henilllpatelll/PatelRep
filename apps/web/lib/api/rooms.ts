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
