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

export interface RoleSchedule {
  id: string
  override_role: 'housekeeping_supervisor' | 'chief_engineer'
  days_of_week: number[]  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_date?: string
  end_date?: string
  created_at: string
}

export interface CreateRoleScheduleData {
  override_role: 'housekeeping_supervisor' | 'chief_engineer'
  days_of_week: number[]
  start_date?: string
  end_date?: string
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

export interface CustomRole {
  id: string
  name: string
  description?: string
  base_role: UserRole
  allowed_modules: string[]
  is_active: boolean
  created_at: string
}

export interface CreateCustomRoleData {
  name: string
  description?: string
  base_role: UserRole
  allowed_modules: string[]
}

export interface UpdateCustomRoleData {
  name?: string
  description?: string
  base_role?: UserRole
  allowed_modules?: string[]
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

  getEffectiveRole: (): Promise<{ data: { base_role: string; effective_role: string; schedule_id: string | null; is_overridden: boolean } }> =>
    apiClient.get('/staff/me/effective-role'),

  getRoleSchedules: (userId: string): Promise<{ data: RoleSchedule[] }> =>
    apiClient.get(`/staff/${userId}/role-schedules`),

  createRoleSchedule: (userId: string, data: CreateRoleScheduleData): Promise<{ data: RoleSchedule }> =>
    apiClient.post(`/staff/${userId}/role-schedules`, data),

  deleteRoleSchedule: (userId: string, scheduleId: string): Promise<{ data: { success: boolean } }> =>
    apiClient.delete(`/staff/${userId}/role-schedules/${scheduleId}`),

  listCustomRoles: (): Promise<{ data: CustomRole[] }> =>
    apiClient.get('/staff/custom-roles'),

  createCustomRole: (data: CreateCustomRoleData): Promise<{ data: CustomRole }> =>
    apiClient.post('/staff/custom-roles', data),

  updateCustomRole: (roleId: string, data: UpdateCustomRoleData): Promise<{ data: CustomRole }> =>
    apiClient.patch(`/staff/custom-roles/${roleId}`, data),

  deleteCustomRole: (roleId: string): Promise<{ data: { success: boolean } }> =>
    apiClient.delete(`/staff/custom-roles/${roleId}`),
}
