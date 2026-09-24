import type { UserRole } from '@/stores/authStore'

export interface TaskCapabilities {
  canViewHotelTasks: boolean
  canViewTeamTasks: boolean
  canAssign: boolean
  canReassign: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  canReview: boolean
  canUpdateTaskStatus: boolean
  canUseAssigneeFilter: boolean
  canUseAdvancedFilters: boolean
}

const ASSIGNMENT_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor', 'front_desk']
const MANAGEMENT_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor']
// GM and front desk assign work, they never perform it themselves — Start/Complete/Cancel
// in the task drawer is limited to the web roles who could actually be the one doing (or
// standing in on the floor for) the work: housekeeping_supervisor and chief_engineer.
const STATUS_UPDATE_ROLES: UserRole[] = ['housekeeping_supervisor', 'chief_engineer']

/** UI capabilities intentionally narrow the backend's broad task PATCH endpoint. */
export function getTaskCapabilities(role: UserRole | null): TaskCapabilities {
  const canManage = !!role && MANAGEMENT_ROLES.includes(role)
  const canAssign = !!role && ASSIGNMENT_ROLES.includes(role)
  const canCreate = !!role && ['gm', 'housekeeping_supervisor', 'front_desk', 'engineer', 'housekeeper', 'chief_engineer'].includes(role)
  return {
    canViewHotelTasks: !!role && role !== 'housekeeper',
    canViewTeamTasks: !!role,
    canAssign,
    canReassign: canAssign,
    canCreate,
    canEdit: canManage,
    canDelete: canManage,
    canReview: canManage,
    canUpdateTaskStatus: !!role && STATUS_UPDATE_ROLES.includes(role),
    canUseAssigneeFilter: canAssign,
    canUseAdvancedFilters: canManage,
  }
}
