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
  Sparkles,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
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
      { href: '/housekeeping/inspections', label: 'Inspection History' },
      { href: '/housekeeping/rooms', label: 'All Rooms' },
    ],
  },
  {
    href: '/engineering',
    label: 'Maintenance',
    icon: Wrench,
    subNav: [
      { href: '/engineering/work-orders', label: 'Work Orders' },
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
  { href: '/ai', label: 'AI Copilot', icon: Sparkles },
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
    '/ai',
  ],
  housekeeping_supervisor: [
    '/dashboard',
    '/housekeeping',
    '/guest-requests',
    '/lost-found',
    '/tasks',
    '/scheduling',
    '/logbook',
    '/sop',
    '/reports',
    '/ai',
  ],
  housekeeper: ['/dashboard', '/housekeeping', '/tasks', '/logbook'],
  chief_engineer: [
    '/dashboard',
    '/engineering',
    '/tasks',
    '/scheduling',
    '/logbook',
    '/sop',
    '/reports',
    '/ai',
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
  chief_engineer: 'Chief of Maintenance',
  housekeeper: 'Housekeeper',
  engineer: 'Maintenance Tech',
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
  '/ai',
]

const PEOPLE_HREFS = ['/staff', '/scheduling']

const KNOWLEDGE_HREFS = ['/sop', '/reports', '/logbook']

// ─── Component ────────────────────────────────────────────────────────────────

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const { role, canViewBilling } = useRole()
  const { user } = useAuth()
  const { hotel } = useHotelStore()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email ||
    'User'

  const initials = getInitials(fullName)
  const avatarBg = getAvatarColor(fullName)
  const roleLabel = role ? ROLE_LABELS[role] : null

  const allowedHrefs: string[] =
    customRoleModules
      ? ['/dashboard', ...customRoleModules.map(m => `/${m}`)]
      : role === 'front_desk'
      ? ['/dashboard', ...(hotel?.front_desk_modules ?? ['housekeeping', 'guest-requests', 'lost-found', 'tasks', 'logbook']).map(m => `/${m}`)]
      : role ? NAV_BY_ROLE[role] : []

  const visibleNavItems: NavItem[] = role
    ? ALL_NAV_ITEMS.filter((item) => allowedHrefs.includes(item.href))
    : ALL_NAV_ITEMS

  const settingsItem: NavItem = { href: '/settings', label: 'Settings', icon: Settings }
  const billingItem: NavItem = { href: '/settings/billing', label: 'Billing', icon: CreditCard }
  const bottomItems = role === 'gm'
    ? [settingsItem, ...(canViewBilling ? [billingItem] : [])]
    : []

  const operationsItems = visibleNavItems.filter((item) => OPERATIONS_HREFS.includes(item.href))
  const peopleItems = visibleNavItems.filter((item) => PEOPLE_HREFS.includes(item.href))
  const knowledgeItems = visibleNavItems.filter((item) => KNOWLEDGE_HREFS.includes(item.href))

  const renderNavItem = ({ href, label, icon: Icon, subNav }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    const subNavOpen = subNav && (pathname === href || pathname.startsWith(href + '/'))
    return (
      <div key={href}>
        <div className="relative">
          {active && (
            <motion.div
              layoutId="sidebar-active"
              className="absolute inset-0 bg-amber-400/10 border-l-2 border-amber-400 rounded-xl"
              style={{ zIndex: -1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            />
          )}
          <Link
            href={href}
            prefetch={false}
            onClick={onMobileClose}
            className={cn(
              'group flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative',
              active
                ? 'text-[#FEFAF4] font-semibold'
                : 'text-[#C4AE98] hover:bg-[#201710] hover:text-[#FEFAF4] cursor-pointer'
            )}
          >
            <Icon
              className={cn(
                'w-4 h-4 shrink-0 transition-colors',
                active ? 'text-amber-400' : 'text-[#6B5744] group-hover:text-[#C4AE98]'
              )}
            />
            <span
              className={cn(
                'inline-block transition-transform duration-150',
                !active && 'group-hover:translate-x-0.5'
              )}
            >
              {label}
            </span>
          </Link>
        </div>
        {subNavOpen && subNav && (
          <div className="mt-0.5 ml-4 pl-2 border-l border-[#2D221A] space-y-0.5">
            {subNav.map(({ href: subHref, label: subLabel }) => {
              const subActive =
                pathname === subHref ||
                (subHref !== href && pathname.startsWith(subHref + '/'))
              return (
                <Link
                  key={subHref}
                  href={subHref}
                  prefetch={false}
                  onClick={onMobileClose}
                  className={cn(
                    'block px-2.5 py-2 text-sm rounded-lg transition-colors duration-200',
                    subActive
                      ? 'bg-amber-400/10 text-amber-300 font-semibold'
                      : 'text-[#C4AE98] hover:bg-[#201710] hover:text-[#FEFAF4] cursor-pointer'
                  )}
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
    const active = pathname === href
    return (
      <div key={href}>
        <div className="relative">
          {active && (
            <motion.div
              layoutId="sidebar-bottom-active"
              className="absolute inset-0 bg-amber-400/10 border-l-2 border-amber-400 rounded-xl"
              style={{ zIndex: -1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            />
          )}
          <Link
            href={href}
            prefetch={false}
            onClick={onMobileClose}
            className={cn(
              'group flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 relative',
              active
                ? 'text-[#FEFAF4] font-semibold'
                : 'text-[#C4AE98] hover:bg-[#201710] hover:text-[#FEFAF4] cursor-pointer'
            )}
          >
            <Icon
              className={cn(
                'w-4 h-4 shrink-0 transition-colors',
                active ? 'text-amber-400' : 'text-[#6B5744] group-hover:text-[#C4AE98]'
              )}
            />
            <span
              className={cn(
                'inline-block transition-transform duration-150',
                !active && 'group-hover:translate-x-0.5'
              )}
            >
              {label}
            </span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'bg-[#17130F] border-r border-[#2D221A] flex flex-col shrink-0',
        // Mobile: fixed overlay drawer
        'fixed inset-y-0 left-0 z-40 w-[280px] transition-transform duration-300 ease-in-out',
        // Desktop: in-flow, always visible
        'md:relative md:w-[240px] md:translate-x-0',
        // Mobile open/close
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo */}
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-lg text-amber-400 font-bold leading-tight tracking-tight">✦ PatelRep</h1>
        <p className="text-[#6B5744] text-xs mt-0.5">Hotel Operations AI</p>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {/* Operations section */}
        {operationsItems.length > 0 && (
          <>
            <p className="text-[10px] font-semibold text-[#4A3728] uppercase tracking-[0.18em] px-2 pt-3 pb-1">
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
            <div className="mx-2 my-2 border-t border-[#2D221A]" />
            <p className="text-[10px] font-semibold text-[#4A3728] uppercase tracking-[0.18em] px-2 pb-1">
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
            <div className="mx-2 my-2 border-t border-[#2D221A]" />
            <p className="text-[10px] font-semibold text-[#4A3728] uppercase tracking-[0.18em] px-2 pb-1">
              Knowledge
            </p>
            <div className="space-y-0.5">
              {knowledgeItems.map(renderNavItem)}
            </div>
          </>
        )}
      </nav>

      {/* Bottom: Settings / Billing */}
      <div className="px-3 pt-2 pb-1 space-y-0.5 border-t border-[#2D221A]">
        {bottomItems.map(renderBottomLink)}
      </div>

      {/* User identity badge */}
      <div className="px-3 pb-4 pt-2">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#201710] border border-[#2D221A]">
          <div
            className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#FEFAF4] truncate leading-tight">
              {fullName}
            </p>
            {roleLabel && (
              <p className="text-xs text-[#6B5744] truncate leading-tight mt-0.5">
                {roleLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
