import { apiClient } from './client'

export type LateCheckoutStatus = 'pending' | 'approved' | 'denied'

export interface LateCheckoutRequest {
  id: string
  tenant_id: string
  room_id: string
  room_number: string
  requested_by: string
  requested_time: string
  status: LateCheckoutStatus
  confirmed_time?: string
  resolved_by?: string
  notes?: string
  created_at: string
  resolved_at?: string
}

export const lateCheckoutApi = {
  list: (params?: { status?: LateCheckoutStatus }) =>
    apiClient.get('/late-checkout/requests', { params }) as Promise<{ data: LateCheckoutRequest[] }>,

  resolve: (id: string, data: { status: 'approved' | 'denied'; confirmed_time?: string; notes?: string }) =>
    apiClient.patch(`/late-checkout/requests/${id}`, data) as Promise<{ data: LateCheckoutRequest | null }>,
}
