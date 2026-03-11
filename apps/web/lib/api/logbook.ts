import { apiClient } from '@/lib/api/client'

export interface LogbookEntry {
  id: string
  department_id: string
  shift_id?: string
  entry_date: string
  content: string
  is_ai_generated: boolean
  author_id: string
  created_at: string
  // Joined
  user_profiles?: { preferred_name?: string; full_name?: string }
  departments?: { name: string }
}

export interface Department {
  id: string
  name: string
  code: string
}

export const logbookApi = {
  listEntries: (params?: {
    department_id?: string
    entry_date?: string
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/logbook/entries', { params }) as Promise<{
      data: LogbookEntry[]
      meta: { page: number; per_page: number }
    }>,

  createEntry: (payload: {
    department_id: string
    shift_id?: string
    content: string
  }) =>
    apiClient.post('/logbook/entries', payload) as Promise<{ data: LogbookEntry }>,

  listDepartments: (hotelId: string) =>
    apiClient.get(`/hotels/${hotelId}/departments`) as Promise<{ data: Department[] }>,

  generateShiftSummary: (payload: { shift_id: string; shift_date: string }) =>
    apiClient.post('/logbook/shift-summary/generate', payload) as Promise<{ data: { summary_text: string; tasks_completed: number; open_work_orders: number } }>,

  getShiftSummary: (shiftId: string) =>
    apiClient.get(`/logbook/shift-summary/${shiftId}`) as Promise<{ data: { summary_text: string; generated_by_ai: boolean } }>,
}
