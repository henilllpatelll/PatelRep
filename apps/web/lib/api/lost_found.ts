import { apiClient } from '@/lib/api/client'

export type LostFoundStatus = 'unclaimed' | 'claimed' | 'donated' | 'discarded'

export interface LostFoundItem {
  id: string
  description: string
  location_found?: string
  notes?: string
  photo_url?: string
  tag_identifier?: string
  storage_location?: string
  retention_due_at?: string
  room_id?: string
  status: LostFoundStatus
  found_by: string
  claimed_by_name?: string
  claimed_by_contact?: string
  claimed_at?: string
  disposition_flagged_at?: string
  disposition_approved_by?: string
  release_verified_at?: string
  release_verification_method?: string
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
    disposition_due?: boolean
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
    photo_url?: string
    tag_identifier?: string
    storage_location?: string
  }) =>
    apiClient.post('/lost-found', payload) as Promise<{ data: LostFoundItem }>,

  updateItem: (
    id: string,
    payload: {
      description?: string
      location_found?: string
      room_id?: string
      notes?: string
      status?: LostFoundStatus
      claimed_by_name?: string
      claimed_by_contact?: string
      claimed_at?: string
    },
  ) =>
    apiClient.patch(`/lost-found/${id}`, payload) as Promise<{ data: LostFoundItem }>,

  deleteItem: (id: string) =>
    apiClient.delete(`/lost-found/${id}`),

  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post('/lost-found/upload-photo', form) as Promise<{ data: { url: string } }>
  },

  listCustodyEvents: (id: string) =>
    apiClient.get(`/lost-found/${id}/custody-events`) as Promise<{ data: LostFoundCustodyEvent[] }>,

  recordCustodyEvent: (
    id: string,
    payload: {
      event_type: LostFoundCustodyEvent['event_type']
      storage_location?: string
      recipient_name?: string
      verification_method?: string
      disposition?: 'claimed' | 'donated' | 'discarded'
      note?: string
    },
  ) =>
    apiClient.post(`/lost-found/${id}/custody-events`, payload) as
      Promise<{ data: LostFoundCustodyEvent }>,
}

export interface LostFoundCustodyEvent {
  id: string
  event_type: 'intake' | 'moved' | 'released' | 'disposition'
  storage_location?: string
  recipient_name?: string
  verification_method?: string
  disposition?: 'claimed' | 'donated' | 'discarded'
  note?: string
  created_at: string
}

/** D-10: shared "is this item due for a disposition decision" predicate — status still unclaimed
 * (the API's `disposition_due` filter is equivalent) but past its retention date. */
export function isDispositionDue(item: LostFoundItem, now: Date = new Date()): boolean {
  if (item.status !== 'unclaimed' || !item.retention_due_at) return false
  return new Date(item.retention_due_at).getTime() < now.getTime()
}
