'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Bed, Wrench, Users, Calendar, BookOpen,
  FileText, Library, Settings, CreditCard, Bell, ClipboardList,
  Package, Sparkles, ChevronDown,
} from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/stores/authStore'

interface SubNavItem { href: string; label: string }
interface NavItem { href: string; label: string; icon: React.ElementType; subNav?: SubNavItem[]; count?: number; tag?: string }

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/housekeeping',   label: 'Housekeeping',   icon: Bed,         subNav: [
    { href: '/housekeeping',             label: 'Room Board' },
    { href: '/housekeeping/assignments', label: 'Assignments' },
    { href: '/housekeeping/inspections', label: 'Inspections' },
    { href: '/housekeeping/rooms',       label: 'All Rooms' },
  ]},
  { href: '/engineering',    label: 'Engineering',    icon: Wrench,      subNav: [
    { href: '/engineering/work-orders',  label: 'Work Orders' },
    { href: '/engineering/assets',       label: 'Assets' },
    { href: '/engineering/pm-schedules', label: 'PM Schedules' },
    { href: '/engineering/predictions',  label: 'Predictions' },
  ]},
  { href: '/guest-requests', label: 'Guest Requests', icon: Bell },
  { href: '/lost-found',     label: 'Lost & Found',   icon: Package },
  { href: '/tasks',          label: 'Tasks',          icon: ClipboardList },
  { href: '/ai',             label: 'AI Copilot',     icon: Sparkles,    tag: 'AI' },
  { href: '/sop',            label: 'SOP Library',    icon: Library },
  { href: '/reports',        label: 'Reports',        icon: FileText },
  { href: '/logbook',        label: 'Logbook',        icon: BookOpen },
  { href: '/staff',          label: 'Staff',          icon: Users },
  { href: '/scheduling',     label: 'Schedule',       icon: Calendar },
]

const NAV_BY_ROLE: Record<UserRole, string[]> = {
  gm: ['/dashboard','/housekeeping','/engineering','/guest-requests','/lost-found','/tasks','/staff','/scheduling','/logbook','/sop','/reports','/ai'],
  housekeeping_supervisor: ['/dashboard','/housekeeping','/guest-requests','/lost-found','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  housekeeper:    ['/dashboard','/housekeeping','/tasks','/logbook'],
  chief_engineer: ['/dashboard','/engineering','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  engineer:       ['/dashboard','/engineering','/tasks','/logbook'],
  front_desk:     ['/dashboard','/housekeeping','/tasks','/logbook','/guest-requests','/lost-found'],
}

const ROLE_LABELS: Record<UserRole, string> = {
  gm:                      'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer:          'Chief of Maintenance',
  housekeeper:             'Housekeeper',
  engineer:                'Maintenance Tech',
  front_desk:              'Front Desk',
}

const OPERATIONS_HREFS  = ['/dashboard','/housekeeping','/engineering','/guest-requests','/lost-found','/tasks']
const INTELLIGENCE_HREFS = ['/ai','/sop','/reports']
const PEOPLE_HREFS       = ['/staff','/scheduling','/logbook']

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
    user?.email || 'User'

  const initials  = getInitials(fullName)
  const avatarBg  = getAvatarColor(fullName)
  const roleLabel = role ? ROLE_LABELS[role] : null

  const allowedHrefs: string[] =
    customRoleModules
      ? ['/dashboard', ...customRoleModules.map(m => `/${m}`)]
      : role === 'front_desk'
      ? ['/dashboard', ...(hotel?.front_desk_modules ?? ['housekeeping','guest-requests','lost-found','tasks','logbook']).map(m => `/${m}`)]
      : role ? NAV_BY_ROLE[role] : []

  const visibleNavItems = role
    ? ALL_NAV_ITEMS.filter(item => allowedHrefs.includes(item.href))
    : ALL_NAV_ITEMS

  const settingsItem: NavItem = { href: '/settings',         label: 'Settings', icon: Settings }
  const billingItem:  NavItem = { href: '/settings/billing', label: 'Billing',  icon: CreditCard }
  const bottomItems = role === 'gm' ? [settingsItem, ...(canViewBilling ? [billingItem] : [])] : []

  const opsItems   = visibleNavItems.filter(i => OPERATIONS_HREFS.includes(i.href))
  const intelItems = visibleNavItems.filter(i => INTELLIGENCE_HREFS.includes(i.href))
  const peopleItems = visibleNavItems.filter(i => PEOPLE_HREFS.includes(i.href))

  const renderNavItem = ({ href, label, icon: Icon, subNav, tag }: NavItem) => {
    const active     = pathname === href || pathname.startsWith(href + '/')
    const subNavOpen = subNav && (pathname === href || pathname.startsWith(href + '/'))

    return (
      <div key={href}>
        <div className="relative">
          {active && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-full" />
          )}
          <Link
            href={href}
            prefetch={false}
            onClick={onMobileClose}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 pl-3.5 pr-3 py-[7px] text-[13px] rounded-lg transition-colors duration-150',
              active
                ? 'bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]'
                : 'text-ink2 hover:bg-surface-2 hover:text-ink'
            )}
          >
            <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-accent' : 'text-ink3')} />
            <span className="flex-1">{label}</span>
            {tag && (
              <span className="text-[9px] font-bold tracking-wide px-1.5 py-px rounded bg-ai-soft text-ai border border-ai-line">
                {tag}
              </span>
            )}
          </Link>
        </div>
        {subNavOpen && subNav && (
          <div className="mt-0.5 ml-3.5 pl-3 border-l border-line-2 space-y-px">
            {subNav.map(({ href: subHref, label: subLabel }) => {
              const subActive = pathname === subHref || (subHref !== href && pathname.startsWith(subHref + '/'))
              return (
                <Link
                  key={subHref}
                  href={subHref}
                  prefetch={false}
                  onClick={onMobileClose}
                  className={cn(
                    'flex items-center min-h-[36px] px-2.5 py-1.5 text-[12px] rounded-md transition-colors',
                    subActive ? 'bg-accent-soft text-accent font-medium' : 'text-ink3 hover:bg-surface-2 hover:text-ink2'
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

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'bg-paper border-r border-line flex flex-col shrink-0',
        'fixed inset-y-0 left-0 z-40 w-[240px] transition-transform duration-300 ease-in-out',
        'md:relative md:w-[232px] md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo + collapse button */}
      <div className="flex items-center justify-between px-3.5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-[7px] bg-ink flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 21V8l8-5 8 5v13" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 21v-6h6v6" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight text-ink">PatelRep</div>
            <div className="text-[10px] text-ink3 font-mono mt-0.5">Hotel Operations AI</div>
          </div>
        </div>
      </div>

      {/* Hotel switcher */}
      {hotel && (
        <div className="mx-3 mb-3 flex items-center gap-2.5 bg-surface border border-line rounded-[10px] px-2.5 py-2 cursor-pointer hover:bg-surface-2 transition-colors">
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-white text-[10px] font-bold font-display shrink-0">
            {hotel.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-none">
            <div className="text-xs font-semibold text-ink truncate">{hotel.name}</div>
            <div className="text-[10px] text-ink3 font-mono mt-0.5">{hotel.room_count ?? '—'} rooms</div>
          </div>
          <ChevronDown className="w-3 h-3 text-ink3 shrink-0" />
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 px-3 overflow-y-auto space-y-3">
        {opsItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4 px-2 pt-1 pb-1.5">Operations</p>
            <div className="space-y-px">{opsItems.map(renderNavItem)}</div>
          </div>
        )}
        {intelItems.length > 0 && (
          <div>
            <div className="mx-1 mb-2 border-t border-line-2" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4 px-2 pb-1.5">Intelligence</p>
            <div className="space-y-px">{intelItems.map(renderNavItem)}</div>
          </div>
        )}
        {peopleItems.length > 0 && (
          <div>
            <div className="mx-1 mb-2 border-t border-line-2" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4 px-2 pb-1.5">Organization</p>
            <div className="space-y-px">{peopleItems.map(renderNavItem)}</div>
          </div>
        )}
      </nav>

      {/* Settings / Billing */}
      {bottomItems.length > 0 && (
        <div className="px-3 pt-2 pb-1 border-t border-line-2 space-y-px">
          {bottomItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <div key={href} className="relative">
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-full" />}
                <Link
                  href={href}
                  prefetch={false}
                  onClick={onMobileClose}
                  className={cn(
                    'group flex items-center gap-2.5 pl-3.5 pr-3 py-[7px] text-[13px] rounded-lg transition-colors',
                    active ? 'bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]' : 'text-ink2 hover:bg-surface-2 hover:text-ink'
                  )}
                >
                  <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-accent' : 'text-ink3')} />
                  {label}
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* User identity */}
      <div className="px-3 pb-4 pt-2 border-t border-line-2">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-surface border border-line">
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0', avatarBg)}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink truncate leading-tight">{fullName}</p>
            {roleLabel && <p className="text-[10px] text-ink3 truncate leading-tight mt-0.5">{roleLabel}</p>}
          </div>
        </div>
      </div>
    </aside>
  )
}
