import type { UserRole } from '@/stores/authStore'

export interface HousekeepingSubNavItem {
  href: string
  label: string
}

const NO_HOUSEKEEPING_SUB_NAV_ITEMS: HousekeepingSubNavItem[] = []

/** Housekeeping opens directly to the Room Board, so no duplicate section is needed. */
export function getHousekeepingSubNavItems(_role: UserRole | null | undefined): HousekeepingSubNavItem[] {
  return NO_HOUSEKEEPING_SUB_NAV_ITEMS
}
