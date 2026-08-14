import { apiClient } from '@/lib/api/client'

export type GuestRequestStatus =
  | 'open' | 'acknowledged' | 'dispatched' | 'arrived' | 'guest_contacted'
  | 'resolved' | 'verified' | 'reopened' | 'cancelled'

export interface GuestRequest {
  id: string
  request_number: number
  title: string
  description?: string
  room_id?: string
  guest_name?: string
  guest_phone?: string
  task_id?: string
  assigned_to?: string
  status: GuestRequestStatus
  priority: 'normal' | 'urgent'
  category: 'service' | 'housekeeping' | 'maintenance' | 'accessibility' | 'other'
  guest_impact: 'low' | 'standard' | 'high'
  sla_minutes: number
  due_at?: string
  acknowledged_at?: string
  dispatched_at?: string
  arrived_at?: string
  guest_contacted_at?: string
  verified_at?: string
  resolved_at?: string
  satisfaction_score?: number
  contact_preference?: 'sms' | 'call' | 'email' | 'in_person' | 'none'
  contact_consent_at?: string
  contact_opted_out_at?: string
  created_by: string
  created_at: string
  updated_at?: string
  // Joined
  rooms?: { room_number: string }
}

export type GuestMessageDeliveryStatus =
  | 'received' | 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'opted_out'

export interface GuestMessage {
  id: string
  direction: 'inbound' | 'outbound'
  channel: 'sms' | 'email'
  body: string
  recipient?: string
  delivery_status: GuestMessageDeliveryStatus
  effective_delivery_status: GuestMessageDeliveryStatus
  failure_reason?: string | null
  created_at: string
}

export interface SlaPolicy {
  id: string
  category: 'service' | 'housekeeping' | 'maintenance' | 'accessibility' | 'other' | null
  priority: 'normal' | 'urgent' | null
  guest_impact: 'low' | 'standard' | 'high' | null
  sla_minutes: number
  created_at: string
}

export interface AccessibleRoomFeature {
  id: string
  room_id: string
  feature_code: string
  description?: string
  operational_status: 'operational' | 'out_of_service' | 'inspection_due'
  guidance?: string
  last_verified_at?: string
  room_status?: string | null
  rooms?: { room_number: string; floor?: number }
}

export const guestRequestsApi = {
  listRequests: (params?: {
    status?: GuestRequestStatus
    room_id?: string
    q?: string
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
    guest_phone?: string
    description?: string
      priority?: 'normal' | 'urgent'
      category?: GuestRequest['category']
      guest_impact?: GuestRequest['guest_impact']
      contact_preference?: 'sms' | 'call' | 'email' | 'in_person' | 'none'
      contact_consent?: boolean
  }) =>
    apiClient.post('/guest-requests', payload) as Promise<{ data: GuestRequest }>,

  updateRequest: (
    id: string,
    payload: {
      title?: string
      description?: string
      room_id?: string
      guest_name?: string
      status?: GuestRequestStatus
      notes?: string
      resolved_at?: string
      assigned_to?: string
    },
  ) =>
    apiClient.patch(`/guest-requests/${id}`, payload) as Promise<{ data: GuestRequest }>,

  transitionRequest: (
    id: string,
    payload: { status: Exclude<GuestRequestStatus, 'open'>; detail?: string },
  ) =>
    apiClient.post(`/guest-requests/${id}/transition`, payload) as Promise<{ data: GuestRequest }>,

  sendMessage: (
    id: string,
    payload: { body: string; recipient?: string; channel?: 'sms' | 'email' },
  ) => apiClient.post(`/guest-requests/${id}/messages`, payload) as Promise<{ data: GuestMessage }>,

  recordRecoveryAction: (
    id: string,
    payload: { action_type: 'apology' | 'amenity' | 'discount' | 'refund' | 'points' | 'other'; description: string; compensation_amount?: number },
  ) => apiClient.post(`/guest-requests/${id}/recovery-actions`, payload),

  recordSatisfaction: (id: string, payload: { satisfaction_score: number }) =>
    apiClient.post(`/guest-requests/${id}/satisfaction`, payload) as Promise<{ data: GuestRequest }>,

  getMetrics: () => apiClient.get('/guest-requests/metrics/summary') as Promise<{ data: GuestRequestMetrics }>,

  deleteRequest: (id: string) =>
    apiClient.delete(`/guest-requests/${id}`),

  listMessages: (id: string) =>
    apiClient.get(`/guest-requests/${id}/messages`) as Promise<{ data: GuestMessage[] }>,

  listSlaPolicies: () =>
    apiClient.get('/guest-requests/sla-policies') as Promise<{ data: SlaPolicy[] }>,

  createSlaPolicy: (payload: {
    category?: SlaPolicy['category']
    priority?: SlaPolicy['priority']
    guest_impact?: SlaPolicy['guest_impact']
    sla_minutes: number
  }) => apiClient.post('/guest-requests/sla-policies', payload) as Promise<{ data: SlaPolicy }>,

  deleteSlaPolicy: (id: string) => apiClient.delete(`/guest-requests/sla-policies/${id}`),

  listAccessibleRoomFeatures: (params?: { feature_code?: string; operational_status?: string }) =>
    apiClient.get('/guest-requests/accessibility/features', { params }) as
      Promise<{ data: AccessibleRoomFeature[] }>,

  upsertAccessibleRoomFeature: (payload: {
    room_id: string
    feature_code: string
    description?: string
    operational_status?: AccessibleRoomFeature['operational_status']
    guidance?: string
  }) => apiClient.put('/guest-requests/accessibility/features', payload) as
      Promise<{ data: AccessibleRoomFeature }>,
}

export interface GuestRequestMetrics {
  total_requests: number
  verified_resolution_rate_pct: number
  sla_met_rate_pct: number
  average_acknowledgement_minutes: number
  average_verified_resolution_minutes: number
}
