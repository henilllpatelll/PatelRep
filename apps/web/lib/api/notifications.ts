import { apiClient } from './client'

export interface Notification {
  id: string
  user_id: string
  hotel_id: string
  title: string
  body: string
  type: string
  is_read: boolean
  metadata?: Record<string, any>
  created_at: string
}

interface ListParams {
  is_read?: boolean
  limit?: number
}

export const notificationsApi = {
  list: (params?: ListParams) =>
    apiClient.get('/notifications', { params }),

  markRead: (id: string) =>
    apiClient.patch(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.post('/notifications/mark-all-read'),

  broadcast: (message: string) =>
    apiClient.post('/notifications/broadcast', { message }),
}
