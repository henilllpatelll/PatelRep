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
  const effectiveRole = useAuthStore((state) => state.effectiveRole)
  // Schedule override wins when present; all role-gated UI reads this value
  const resolved = effectiveRole ?? role

  return {
    role: resolved,
    isGM: resolved === 'gm',
    isSupervisor: hasRole(resolved, SUPERVISOR_ROLES),
    canAssignRooms: hasRole(resolved, ASSIGN_ROOMS_ROLES),
    canViewBilling: resolved === 'gm',
    canManageStaff: resolved === 'gm',
    canViewEngineering: hasRole(resolved, ENGINEERING_ROLES),
  }
}
