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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-brand-600',
    'bg-violet-600',
    'bg-amber-600',
    'bg-teal-600',
    'bg-sky-600',
    'bg-rose-600',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

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

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-gray-100">
        <h1 className="text-xl font-bold text-brand-700">PatelRep</h1>
        <p className="text-xs text-gray-400 mt-0.5">Hotel Operations AI</p>
      </div>

      {/* Main nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ href, label, icon: Icon, subNav }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const subNavOpen = subNav && (pathname === href || pathname.startsWith(href + '/'))
          return (
            <div key={href}>
              <Link
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
              {subNavOpen && subNav && (
                <div className="mt-0.5 ml-4 pl-3 border-l border-gray-200 space-y-0.5">
                  {subNav.map(({ href: subHref, label: subLabel }) => {
                    const subActive =
                      pathname === subHref ||
                      (subHref !== href && pathname.startsWith(subHref + '/'))
                    return (
                      <Link
                        key={subHref}
                        href={subHref}
                        className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          subActive
                            ? 'font-medium text-brand-700 bg-brand-50'
                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
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
        })}
      </nav>

      {/* Bottom: Settings / Billing */}
      <div className="p-3 border-t border-gray-100 space-y-0.5">
        {[settingsItem, ...(canViewBilling ? [billingItem] : [])].map(
          ({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            )
          }
        )}
      </div>

      {/* User identity badge */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-gray-50">
          <div
            className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate leading-tight">
              {fullName}
            </p>
            {roleLabel && (
              <p className="text-xs text-gray-500 truncate leading-tight mt-0.5">
                {roleLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
