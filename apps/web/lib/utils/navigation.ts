import {
  LayoutDashboard, Bed, Wrench, Users, Calendar, BookOpen,
  FileText, Library, Settings, ClipboardList, ShieldCheck,
  Package, Sparkles, MessageSquare, TrendingUp,
} from 'lucide-react'
import type { UserRole } from '@/stores/authStore'

export interface SubNavItem { href: string; label: string }
export interface NavItem { href: string; label: string; icon: React.ElementType; subNav?: SubNavItem[]; count?: number; tag?: string }

export const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/housekeeping',   label: 'Housekeeping',   icon: Bed },
  { href: '/engineering',    label: 'Engineering',    icon: Wrench,      subNav: [
    { href: '/engineering/work-orders',  label: 'Work Orders' },
    { href: '/engineering/assets',       label: 'Assets' },
    { href: '/engineering/pm-schedules', label: 'PM Schedules' },
    { href: '/engineering/predictions',  label: 'Predictions' },
  ]},
  { href: '/programs',       label: 'Operational Programs', icon: ClipboardList },
  { href: '/lost-found',     label: 'Lost & Found',   icon: Package },
  { href: '/guest-requests', label: 'Guest Requests', icon: MessageSquare },
  { href: '/tasks',          label: 'Tasks',          icon: ClipboardList },
  { href: '/ai',             label: 'AI Copilot',     icon: Sparkles,    tag: 'AI' },
  { href: '/sop',            label: 'SOP Library',    icon: Library },
  { href: '/evidence',       label: 'Evidence',       icon: ShieldCheck },
  { href: '/safety',         label: 'Safety',         icon: ShieldCheck },
  { href: '/reports',        label: 'Reports',        icon: FileText },
  { href: '/management-roi', label: 'Management ROI', icon: TrendingUp },
  { href: '/logbook',        label: 'Logbook',        icon: BookOpen },
  { href: '/staff',          label: 'Staff',          icon: Users },
  { href: '/scheduling',     label: 'Schedule',       icon: Calendar },
]

export const SETTINGS_NAV_ITEM: NavItem = { href: '/settings', label: 'Settings', icon: Settings }

export const NAV_BY_ROLE: Record<UserRole, string[]> = {
  gm: ['/dashboard','/housekeeping','/engineering','/programs','/lost-found','/guest-requests','/tasks','/staff','/scheduling','/logbook','/sop','/evidence','/safety','/reports','/management-roi','/ai'],
  housekeeping_supervisor: ['/dashboard','/housekeeping','/engineering','/programs','/lost-found','/guest-requests','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  housekeeper:    ['/dashboard','/housekeeping','/guest-requests'],
  engineer:       ['/dashboard','/engineering','/programs','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  chief_engineer: ['/dashboard','/engineering','/programs','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  front_desk:     ['/dashboard','/housekeeping','/guest-requests','/tasks','/logbook','/lost-found','/ai'],
}

export const DEFAULT_FRONT_DESK_MODULES = ['housekeeping', 'lost-found', 'tasks', 'logbook']

export const NAV_LABEL_KEYS: Record<string, string> = {
  Dashboard: 'nav.dashboard',
  Housekeeping: 'nav.housekeeping',
  'My Rooms': 'nav.myRooms',
  Engineering: 'nav.engineering',
  'Work Orders': 'nav.workOrders',
  Assets: 'nav.assets',
  'PM Schedules': 'nav.pmSchedules',
  'Operational Programs': 'nav.programs',
  Predictions: 'nav.predictions',
  'Lost & Found': 'nav.lostFound',
  'Guest Requests': 'nav.guestRequests',
  Tasks: 'nav.tasks',
  'AI Copilot': 'nav.aiCopilot',
  'SOP Library': 'nav.sopLibrary',
  Evidence: 'nav.evidence',
  Safety: 'nav.safety',
  Reports: 'nav.reports',
  'Management ROI': 'nav.managementRoi',
  Logbook: 'nav.logbook',
  Staff: 'nav.staff',
  Schedule: 'nav.schedule',
  Settings: 'nav.settings',
  'Room Board': 'nav.roomBoard',
  Assignments: 'nav.assignments',
  Inspections: 'nav.inspections',
}

export const OPERATIONS_HREFS   = ['/dashboard','/housekeeping','/engineering','/programs','/lost-found','/guest-requests','/tasks']
export const INTELLIGENCE_HREFS = ['/ai','/sop','/evidence','/safety','/reports','/management-roi']
export const PEOPLE_HREFS       = ['/staff','/scheduling','/logbook']

export interface AllowedNavParams {
  role: UserRole | null
  customRoleModules?: string[] | null
  frontDeskModules?: string[] | null
}

/** Single source of truth for "which routes can this user reach" — Sidebar, CommandPalette,
 * and Breadcrumbs all read through this so nothing can drift out of sync with RBAC. */
export function getAllowedHrefs({ role, customRoleModules, frontDeskModules }: AllowedNavParams): string[] {
  if (customRoleModules) return ['/dashboard', ...customRoleModules.map((m) => `/${m}`)]
  if (role === 'front_desk') {
    return ['/dashboard', ...(frontDeskModules ?? DEFAULT_FRONT_DESK_MODULES).map((m) => `/${m}`)]
  }
  return role ? (NAV_BY_ROLE[role] ?? []) : []
}

export function getAllowedNavItems(params: AllowedNavParams): NavItem[] {
  if (!params.role) return ALL_NAV_ITEMS
  const allowed = getAllowedHrefs(params)
  return ALL_NAV_ITEMS.filter((item) => allowed.includes(item.href))
}
