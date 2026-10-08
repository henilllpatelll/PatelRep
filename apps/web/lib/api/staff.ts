import { apiClient } from '@/lib/api/client'
import type { UserRole } from '@/stores/authStore'

export interface StaffMember {
  id: string
  user_id: string
  hotel_id: string
  full_name: string
  preferred_name?: string | null
  email: string
  role: UserRole
  department_id?: string | null
  department_name?: string | null
  status: 'active' | 'inactive'
  avatar_url?: string | null
  created_at: string
  custom_role_id?: string | null
  custom_role_name?: string | null
  /** GM-only: omitted from every non-GM response. */
  phone?: string | null
  /** GM-only internal labor-costing rate: omitted from every non-GM response. */
  hourly_rate?: number | null
}

/** `active` (default, operational pickers) | `inactive` / `all` (GM-only management views). */
export type StaffStatusFilter = 'active' | 'inactive' | 'all'

export interface StaffListParams {
  status?: StaffStatusFilter
  department_id?: string
}

export interface Department {
  id: string
  name: string
  code: string
  color: string
}

export interface UpdateStaffProfileData {
  full_name?: string
  preferred_name?: string | null
  phone?: string | null
  avatar_url?: string | null
}

export interface StaffProfile {
  id: string
  full_name: string
  preferred_name: string | null
  phone: string | null
  avatar_url: string | null
}

export type InvitationStatus = 'pending' | 'expired' | 'revoked' | 'accepted'
/** Outcome of our request to the email provider: `requested` is NOT proof the email reached an inbox. */
export type InvitationDeliveryStatus = 'requested' | 'failed' | 'existing_account'

export interface InvitationDelivery {
  status: InvitationDeliveryStatus | null
  error: string | null
  note: string
}

export interface StaffInvitation {
  id: string
  hotel_id: string
  email: string
  full_name?: string | null
  phone?: string | null
  role: UserRole
  department_id?: string | null
  department_name?: string | null
  status: InvitationStatus
  invited_at: string
  created_at: string
  expires_at: string
  accepted_at?: string | null
  revoked_at?: string | null
  last_sent_at?: string | null
  send_count?: number | null
  delivery: InvitationDelivery
}

/** `open` (default) = pending + expired. */
export type InvitationStatusFilter = 'open' | InvitationStatus | 'all'

export interface InviteStaffData {
  full_name: string
  email: string
  role: UserRole
  department_id?: string
  phone?: string
}

export interface ReissueInvitationData {
  role?: UserRole
  department_id?: string
  full_name?: string
  phone?: string
}

export interface AddDirectData {
  full_name: string
  preferred_name?: string
  email: string
  role: UserRole
  department_id?: string
  custom_role_id?: string
  phone?: string
  /** Omit to have the server generate a one-time password. */
  password?: string
}

export interface AddDirectResult {
  success: boolean
  user_id: string
  full_name: string
  /** Returned once by the create call; never persist or log it. */
  temp_password: string
}

export interface UpdateStaffData {
  role?: UserRole
  department_id?: string | null
  /** Legacy field; the API reads `is_active`. Prefer deactivate()/reactivate(). */
  status?: 'active' | 'inactive'
  is_active?: boolean
  custom_role_id?: string | null
  hourly_rate?: number | null
}

export interface RoleSchedule {
  id: string
  override_role: 'housekeeping_supervisor' | 'engineer'
  days_of_week: number[]  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_date?: string
  end_date?: string
  created_at: string
}

export interface CreateRoleScheduleData {
  override_role: 'housekeeping_supervisor' | 'engineer'
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
  data: StaffInvitation
}

export interface InvitationResponse {
  data: StaffInvitation
}

export interface AcceptInvitationResponse {
  data: { accepted: boolean; already_member: boolean; hotel_id: string; role?: string }
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
  /** No args = active staff only (operational pickers). `status: 'inactive' | 'all'` is GM-only. */
  list: (params?: StaffListParams): Promise<StaffListResponse> =>
    apiClient.get('/staff', params && Object.keys(params).length ? { params } : undefined),

  get: (userId: string): Promise<{ data: StaffMember }> =>
    apiClient.get(`/staff/${userId}`),

  updateProfile: (userId: string, data: UpdateStaffProfileData): Promise<{ data: StaffProfile }> =>
    apiClient.patch(`/staff/${userId}/profile`, data),

  reactivate: (userId: string): Promise<{ data: { success: boolean; reactivated_user_id: string; status: 'active' } }> =>
    apiClient.post(`/staff/${userId}/reactivate`),

  listDepartments: (): Promise<{ data: Department[] }> =>
    apiClient.get('/staff/departments'),

  invite: (data: InviteStaffData): Promise<InviteStaffResponse> =>
    apiClient.post('/staff/invite', data),

  update: (staffId: string, data: UpdateStaffData): Promise<UpdateStaffResponse> =>
    apiClient.patch(`/staff/${staffId}`, data),

  deactivate: (staffId: string): Promise<void> =>
    apiClient.delete(`/staff/${staffId}`),

  listInvitations: (status?: InvitationStatusFilter): Promise<StaffInvitationsResponse> =>
    apiClient.get('/staff/invitations', status ? { params: { status } } : undefined),

  /** Resolves with the refreshed invitation, including the new email-request outcome. */
  resendInvitation: (invitationId: string): Promise<InvitationResponse> =>
    apiClient.post(`/staff/invitations/${invitationId}/resend`),

  revokeInvitation: (invitationId: string): Promise<InvitationResponse> =>
    apiClient.delete(`/staff/invitations/${invitationId}`),

  /** Revoke-and-reissue: the way to change an outstanding invitation's role/department/name/phone. */
  reissueInvitation: (invitationId: string, data: ReissueInvitationData): Promise<InvitationResponse> =>
    apiClient.post(`/staff/invitations/${invitationId}/reissue`, data),

  /** Called by the signed-in invitee (email-bound); refresh the session afterwards for new claims. */
  acceptInvitation: (): Promise<AcceptInvitationResponse> =>
    apiClient.post('/staff/invitations/accept'),

  addDirect: (data: AddDirectData): Promise<{ data: AddDirectResult }> =>
    apiClient.post('/staff/add-direct', data),

  getEffectiveRole: (): Promise<{ data: { base_role: string; effective_role: string; schedule_id: string | null; is_overridden: boolean; custom_role: { id: string; name: string; allowed_modules: string[] } | null } }> =>
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
