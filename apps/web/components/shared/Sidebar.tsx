'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Bed,
  Wrench,
  Users,
  Calendar,
  BookOpen,
  FileText,
  Library,
  Settings,
  CreditCard,
  Bell,
  ClipboardList,
  Package,
} from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import type { UserRole } from '@/stores/authStore'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SubNavItem {
  href: string
  label: string
}

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  subNav?: SubNavItem[]
}

// ─── Role-based nav definitions ──────────────────────────────────────────────

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/housekeeping',
    label: 'Housekeeping',
    icon: Bed,
    subNav: [
      { href: '/housekeeping', label: 'Room Board' },
      { href: '/housekeeping/assignments', label: 'Assignments' },
      { href: '/housekeeping/inspections', label: 'Inspections' },
      { href: '/housekeeping/rooms', label: 'All Rooms' },
    ],
  },
  {
    href: '/engineering',
    label: 'Engineering',
    icon: Wrench,
    subNav: [
      { href: '/engineering', label: 'Work Orders' },
      { href: '/engineering/assets', label: 'Assets' },
      { href: '/engineering/pm-schedules', label: 'PM Schedules' },
      { href: '/engineering/predictions', label: 'Predictions' },
    ],
  },
  { href: '/guest-requests', label: 'Guest Requests', icon: Bell },
  { href: '/lost-found', label: 'Lost & Found', icon: Package },
  { href: '/tasks', label: 'Tasks', icon: ClipboardList },
  { href: '/staff', label: 'Staff', icon: Users },
  { href: '/scheduling', label: 'Schedule', icon: Calendar },
  { href: '/logbook', label: 'Logbook', icon: BookOpen },
  { href: '/sop', label: 'SOP Library', icon: Library },
  { href: '/reports', label: 'Reports', icon: FileText },
]

const NAV_BY_ROLE: Record<UserRole, string[]> = {
  gm: [
    '/dashboard',
    '/housekeeping',
    '/engineering',
    '/guest-requests',
    '/lost-found',
    '/tasks',
    '/staff',
    '/scheduling',
    '/logbook',
    '/sop',
    '/reports',
  ],
  housekeeping_supervisor: [
    '/dashboard',
    '/housekeeping',
    '/guest-requests',
    '/lost-found',
    '/tasks',
    '/staff',
    '/scheduling',
    '/logbook',
    '/sop',
    '/reports',
  ],
  housekeeper: ['/dashboard', '/housekeeping', '/tasks', '/logbook'],
  chief_engineer: [
    '/dashboard',
    '/engineering',
    '/tasks',
    '/staff',
    '/scheduling',
    '/logbook',
    '/sop',
    '/reports',
  ],
  engineer: ['/dashboard', '/engineering', '/tasks', '/logbook'],
  front_desk: [
    '/dashboard',
    '/housekeeping',
    '/tasks',
    '/logbook',
    '/guest-requests',
    '/lost-found',
  ],
}

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

// ─── Nav section definitions ──────────────────────────────────────────────────

const OPERATIONS_HREFS = [
  '/dashboard',
  '/housekeeping',
  '/engineering',
  '/guest-requests',
  '/lost-found',
  '/tasks',
]

const PEOPLE_HREFS = ['/staff', '/scheduling']

const KNOWLEDGE_HREFS = ['/sop', '/reports', '/logbook']

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const { role, canViewBilling } = useRole()
  const { user } = useAuth()

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email ||
    'User'

  const initials = getInitials(fullName)
  const avatarBg = getAvatarColor(fullName)
  const roleLabel = role ? ROLE_LABELS[role] : null

  // Determine which nav items to show based on role
  const allowedHrefs: string[] = role ? NAV_BY_ROLE[role] : []

  const visibleNavItems: NavItem[] = role
    ? ALL_NAV_ITEMS.filter((item) => allowedHrefs.includes(item.href))
    : ALL_NAV_ITEMS

  const settingsItem: NavItem = { href: '/settings', label: 'Settings', icon: Settings }
  const billingItem: NavItem = { href: '/settings/billing', label: 'Billing', icon: CreditCard }

  // Partition visible items into sections
  const operationsItems = visibleNavItems.filter((item) => OPERATIONS_HREFS.includes(item.href))
  const peopleItems = visibleNavItems.filter((item) => PEOPLE_HREFS.includes(item.href))
  const knowledgeItems = visibleNavItems.filter((item) => KNOWLEDGE_HREFS.includes(item.href))

  const renderNavItem = ({ href, label, icon: Icon, subNav }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    const subNavOpen = subNav && (pathname === href || pathname.startsWith(href + '/'))
    return (
      <div key={href}>
        <Link
          href={href}
          className={`flex items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium transition-colors duration-200 ${
            active
              ? 'bg-indigo-400/[0.12] text-indigo-600 font-semibold border border-indigo-300/[0.20] rounded-lg'
              : 'text-slate-600 hover:bg-indigo-400/[0.06] hover:text-indigo-600 rounded-lg cursor-pointer'
          }`}
        >
          <Icon size={15} />
          {label}
        </Link>
        {subNavOpen && subNav && (
          <div className="mt-0.5 ml-6 pl-2 border-l border-indigo-200/[0.20] space-y-0.5">
            {subNav.map(({ href: subHref, label: subLabel }) => {
              const subActive =
                pathname === subHref ||
                (subHref !== href && pathname.startsWith(subHref + '/'))
              return (
                <Link
                  key={subHref}
                  href={subHref}
                  className={`block px-2.5 py-1 text-sm rounded-lg transition-colors duration-200 ${
                    subActive
                      ? 'bg-indigo-400/[0.12] text-indigo-600 font-semibold border border-indigo-300/[0.20]'
                      : 'text-slate-600 hover:bg-indigo-400/[0.06] hover:text-indigo-600 cursor-pointer'
                  }`}
                >
                  {subLabel}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const renderBottomLink = ({ href, label, icon: Icon }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium transition-colors duration-200 ${
          active
            ? 'bg-indigo-400/[0.12] text-indigo-600 font-semibold border border-indigo-300/[0.20] rounded-lg'
            : 'text-slate-600 hover:bg-indigo-400/[0.06] hover:text-indigo-600 rounded-lg cursor-pointer'
        }`}
      >
        <Icon size={15} />
        {label}
      </Link>
    )
  }

  return (
    <aside className="w-52 bg-white/[0.62] backdrop-blur-xl border-r border-white/[0.85] flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-lg text-indigo-600 font-extrabold leading-tight">PatelRep</h1>
        <p className="text-slate-400 text-xs mt-0.5">Hotel Operations AI</p>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {/* Operations section */}
        {operationsItems.length > 0 && (
          <>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-3 pb-1">
              Operations
            </p>
            <div className="space-y-0.5">
              {operationsItems.map(renderNavItem)}
            </div>
          </>
        )}

        {/* People section */}
        {peopleItems.length > 0 && (
          <>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-3 pb-1">
              People
            </p>
            <div className="space-y-0.5">
              {peopleItems.map(renderNavItem)}
            </div>
          </>
        )}

        {/* Knowledge section */}
        {knowledgeItems.length > 0 && (
          <>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-2 pt-3 pb-1">
              Knowledge
            </p>
            <div className="space-y-0.5">
              {knowledgeItems.map(renderNavItem)}
            </div>
          </>
        )}
      </nav>

      {/* Bottom: Settings / Billing */}
      <div className="px-3 pt-2 pb-1 space-y-0.5">
        {[settingsItem, ...(canViewBilling ? [billingItem] : [])].map(renderBottomLink)}
      </div>

      {/* User identity badge */}
      <div className="px-3 pb-4 pt-2">
        <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-indigo-400/[0.06]">
          <div
            className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 truncate leading-tight">
              {fullName}
            </p>
            {roleLabel && (
              <p className="text-xs text-slate-400 truncate leading-tight mt-0.5">
                {roleLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
