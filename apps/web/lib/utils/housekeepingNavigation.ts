import type { UserRole } from '@/stores/authStore'

export interface HousekeepingSubNavItem {
  href: string
  label: string
}

const SUPERVISOR_HOUSEKEEPING_TABS: HousekeepingSubNavItem[] = [
  { href: '/housekeeping', label: 'Room Board' },
  { href: '/housekeeping/assignments', label: 'Assignments' },
  { href: '/housekeeping/inspections', label: 'Inspections' },
]

const FRONT_DESK_HOUSEKEEPING_TABS: HousekeepingSubNavItem[] = [
  { href: '/housekeeping', label: 'Room Board' },
]

export function getHousekeepingSubNavItems(role: UserRole | null | undefined): HousekeepingSubNavItem[] {
  if (role === 'gm' || role === 'housekeeping_supervisor') {
    return SUPERVISOR_HOUSEKEEPING_TABS
  }

  if (role === 'front_desk') {
    return FRONT_DESK_HOUSEKEEPING_TABS
  }

  return []
}
