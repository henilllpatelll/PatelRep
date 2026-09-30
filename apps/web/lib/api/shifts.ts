import { apiClient } from '@/lib/api/client'

export type ShiftSessionStatus = 'active' | 'on_break' | 'ended'

export interface ShiftRosterEntry {
  user_id: string
  status: ShiftSessionStatus
  started_at: string
  on_break_since: string | null
  break_seconds: number | null
}

export interface ShiftRosterResponse {
  data: ShiftRosterEntry[]
}

export const shiftsApi = {
  /** Supervisor-facing: latest shift session per housekeeper for a date (default today). */
  getRoster: (date?: string): Promise<ShiftRosterResponse> =>
    apiClient.get('/shifts/roster', { params: date ? { date } : undefined }),
}
