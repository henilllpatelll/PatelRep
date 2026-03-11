import { apiClient } from '@/lib/api/client'

export type GuestRequestStatus = 'open' | 'in_progress' | 'resolved' | 'escalated'

export interface GuestRequest {
  id: string
  request_number: number
  title: string
  description?: string
  room_id?: string
  guest_name?: string
  task_id?: string
  status: GuestRequestStatus
  resolved_at?: string
  satisfaction_score?: number
  created_by: string
  created_at: string
  updated_at?: string
  // Joined
  rooms?: { room_number: string }
}

export const guestRequestsApi = {
  listRequests: (params?: {
    status?: GuestRequestStatus
    room_id?: string
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/guest-requests', { params }) as Promise<{
      data: GuestRequest[]
      meta: { page: number; per_page: number }
    }>,

  createRequest: (payload: {
    title: string
    room_id?: string
    guest_name?: string
    description?: string
  }) =>
    apiClient.post('/guest-requests', payload) as Promise<{ data: GuestRequest }>,

  updateRequest: (
    id: string,
    payload: {
      status?: GuestRequestStatus
      notes?: string
      assigned_to?: string
    },
  ) =>
    apiClient.patch(`/guest-requests/${id}`, payload) as Promise<{ data: GuestRequest }>,
}
