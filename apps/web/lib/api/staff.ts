import { apiClient } from '@/lib/api/client'
import type { UserRole } from '@/stores/authStore'

export interface StaffMember {
  id: string
  user_id: string
  hotel_id: string
  full_name: string
  email: string
  role: UserRole
  department_id?: string
  department_name?: string
  status: 'active' | 'inactive'
  avatar_url?: string
  created_at: string
}

export interface StaffInvitation {
  id: string
  hotel_id: string
  email: string
  role: UserRole
  department_id?: string
  invited_at: string
  expires_at: string
}

export interface InviteStaffData {
  full_name: string
  email: string
  role: UserRole
  department_id?: string
}

export interface UpdateStaffData {
  role?: UserRole
  department_id?: string
  status?: 'active' | 'inactive'
}

export interface StaffListResponse {
  data: {
    staff: StaffMember[]
    total: number
  }
}

export interface StaffInvitationsResponse {
  data: {
    invitations: StaffInvitation[]
    total: number
  }
}

export interface InviteStaffResponse {
  data: {
    invitation: StaffInvitation
  }
}

export interface UpdateStaffResponse {
  data: {
    staff: StaffMember
  }
}

export const staffApi = {
  list: (): Promise<StaffListResponse> =>
    apiClient.get('/staff'),

  invite: (data: InviteStaffData): Promise<InviteStaffResponse> =>
    apiClient.post('/staff/invite', data),

  update: (staffId: string, data: UpdateStaffData): Promise<UpdateStaffResponse> =>
    apiClient.patch(`/staff/${staffId}`, data),

  deactivate: (staffId: string): Promise<void> =>
    apiClient.delete(`/staff/${staffId}`),

  listInvitations: (): Promise<StaffInvitationsResponse> =>
    apiClient.get('/staff/invitations'),

  resendInvitation: (invitationId: string): Promise<void> =>
    apiClient.post(`/staff/invitations/${invitationId}/resend`),

  addDirect: (data: { full_name: string; email: string; role: UserRole; department_id?: string; password?: string }): Promise<{ data: { success: boolean; user_id: string; full_name: string; temp_password: string } }> =>
    apiClient.post('/staff/add-direct', data),
}
