import { apiClient } from '@/lib/api/client'

export type LostFoundStatus = 'unclaimed' | 'claimed' | 'donated' | 'discarded'

export interface LostFoundItem {
  id: string
  description: string
  location_found?: string
  notes?: string
  room_id?: string
  status: LostFoundStatus
  found_by: string
  claimed_by_name?: string
  claimed_by_contact?: string
  claimed_at?: string
  created_at: string
  updated_at?: string
  // Joined
  rooms?: { room_number: string }
  user_profiles?: { preferred_name?: string; full_name?: string }
}

export const lostFoundApi = {
  listItems: (params?: {
    status?: LostFoundStatus
    date_from?: string
    date_to?: string
    search?: string
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/lost-found', { params }) as Promise<{
      data: LostFoundItem[]
      meta: { page: number; per_page: number }
    }>,

  createItem: (payload: {
    description: string
    room_id?: string
    location_found?: string
    notes?: string
  }) =>
    apiClient.post('/lost-found', payload) as Promise<{ data: LostFoundItem }>,

  updateItem: (
    id: string,
    payload: {
      status?: LostFoundStatus
      notes?: string
      claimed_by_name?: string
      claimed_by_contact?: string
    },
  ) =>
    apiClient.patch(`/lost-found/${id}`, payload) as Promise<{ data: LostFoundItem }>,
}
