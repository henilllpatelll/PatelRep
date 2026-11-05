import type { UserRole } from '@/stores/authStore'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'
import { MORE_NAV_HREFS, PRIMARY_NAV_HREFS, getAllowedNavItems, type NavItem } from '@/lib/utils/navigation'

export interface ShellNavGroup {
  id: 'overview' | 'operations' | 'records'
  labelKey: string
  items: NavItem[]
}

/** Which destinations this person sees, grouped. Pure over its inputs so RBAC can be tested without
 *  rendering: it is `getAllowedNavItems` (the single source of truth shared with the legacy sidebar,
 *  the command palette and breadcrumbs) re-bucketed, never a second permission list. */
export function buildShellNavGroups(params: {
  role: UserRole | null
  customRoleModules?: string[] | null
  frontDeskModules?: string[] | null
}): ShellNavGroup[] {
  const allowed = params.role
    ? getAllowedNavItems(params).map((item) =>
        item.href === '/housekeeping' && params.role === 'housekeeper'
          ? { ...item, label: 'My Rooms' }
          : item.href === '/housekeeping'
            ? { ...item, subNav: getHousekeepingSubNavItems(params.role) }
            : item,
      )
    : []
  const overview = allowed.filter((item) => item.href === '/dashboard')
  const operations = allowed.filter((item) => PRIMARY_NAV_HREFS.includes(item.href))
  const records = allowed.filter((item) => MORE_NAV_HREFS.includes(item.href))
  return [
    { id: 'overview' as const, labelKey: 'shellV2.groupOverview', items: overview },
    { id: 'operations' as const, labelKey: 'shellV2.groupOperations', items: operations },
    { id: 'records' as const, labelKey: 'shellV2.groupRecords', items: records },
  ].filter((group) => group.items.length > 0)
}
