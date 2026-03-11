'use client'

import { useAuthStore, type UserRole } from '@/stores/authStore'

export interface RoleCapabilities {
  role: UserRole | null
  isGM: boolean
  isSupervisor: boolean
  canAssignRooms: boolean
  canViewBilling: boolean
  canManageStaff: boolean
  canViewEngineering: boolean
}

const SUPERVISOR_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor', 'chief_engineer']
const ASSIGN_ROOMS_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor']
const ENGINEERING_ROLES: UserRole[] = ['gm', 'chief_engineer', 'engineer']

function hasRole(role: UserRole | null, allowed: UserRole[]): boolean {
  if (!role) return false
  return allowed.includes(role)
}

export function useRole(): RoleCapabilities {
  const role = useAuthStore((state) => state.role)

  return {
    role,
    isGM: role === 'gm',
    isSupervisor: hasRole(role, SUPERVISOR_ROLES),
    canAssignRooms: hasRole(role, ASSIGN_ROOMS_ROLES),
    canViewBilling: role === 'gm',
    canManageStaff: role === 'gm',
    canViewEngineering: hasRole(role, ENGINEERING_ROLES),
  }
}
