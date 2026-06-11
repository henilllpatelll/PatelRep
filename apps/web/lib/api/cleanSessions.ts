import { apiClient } from '@/lib/api/client'

export interface CleanSessionPhoto {
  id: string
  kind: 'proof' | 'issue'
  url: string
  created_at: string
}

export interface CleanSessionDetail {
  id: string
  room_id: string
  housekeeper_id: string
  clean_type: string | null
  duration_seconds: number | null
  base_clean_minutes: number | null
  started_at: string
  ended_at: string | null
  status: 'active' | 'completed' | 'abandoned'
  blocked_reason: string | null
  checklist: { item_id: string | null; label: string; section: string; is_required: boolean; checked: boolean }[]
  checklist_done: number
  checklist_total: number
  notes: string | null
  photos: CleanSessionPhoto[]
}

export const cleanSessionsApi = {
  getSession: (sessionId: string) =>
    apiClient.get(`/clean-sessions/${sessionId}`),
}
