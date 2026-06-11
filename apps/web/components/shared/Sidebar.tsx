'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  LayoutDashboard, Bed, Wrench, Users, Calendar, BookOpen,
  FileText, Library, Settings, ClipboardList,
  Package, Sparkles, ChevronDown, MessageSquare,
} from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/stores/authStore'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'
import { LanguageToggle } from '@/components/shared/LanguageToggle'
import { useTranslation } from 'react-i18next'

interface SubNavItem { href: string; label: string }
interface NavItem { href: string; label: string; icon: React.ElementType; subNav?: SubNavItem[]; count?: number; tag?: string }

const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',      label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/housekeeping',   label: 'Housekeeping',   icon: Bed },
  { href: '/engineering',    label: 'Engineering',    icon: Wrench,      subNav: [
    { href: '/engineering/work-orders',  label: 'Work Orders' },
    { href: '/engineering/assets',       label: 'Assets' },
    { href: '/engineering/pm-schedules', label: 'PM Schedules' },
    { href: '/engineering/predictions',  label: 'Predictions' },
  ]},
  { href: '/lost-found',     label: 'Lost & Found',   icon: Package },
  { href: '/guest-requests', label: 'Guest Requests', icon: MessageSquare },
  { href: '/tasks',          label: 'Tasks',          icon: ClipboardList },
  { href: '/ai',             label: 'AI Copilot',     icon: Sparkles,    tag: 'AI' },
  { href: '/sop',            label: 'SOP Library',    icon: Library },
  { href: '/reports',        label: 'Reports',        icon: FileText },
  { href: '/logbook',        label: 'Logbook',        icon: BookOpen },
  { href: '/staff',          label: 'Staff',          icon: Users },
  { href: '/scheduling',     label: 'Schedule',       icon: Calendar },
]

const NAV_BY_ROLE: Record<UserRole, string[]> = {
  gm: ['/dashboard','/housekeeping','/engineering','/lost-found','/guest-requests','/tasks','/staff','/scheduling','/logbook','/sop','/reports','/ai'],
  housekeeping_supervisor: ['/dashboard','/housekeeping','/lost-found','/guest-requests','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  housekeeper:    ['/dashboard','/housekeeping','/guest-requests'],
  chief_engineer: ['/dashboard','/engineering','/tasks','/scheduling','/logbook','/sop','/reports','/ai'],
  engineer:       ['/dashboard','/engineering','/tasks'],
  front_desk:     ['/dashboard','/housekeeping','/guest-requests','/tasks','/logbook','/lost-found'],
}

const ROLE_LABELS: Record<UserRole, string> = {
  gm:                      'roles.gm',
  housekeeping_supervisor: 'roles.housekeeping_supervisor',
  chief_engineer:          'roles.chief_of_maintenance',
  housekeeper:             'roles.housekeeper',
  engineer:                'roles.maintenance_tech',
  front_desk:              'roles.front_desk',
}

const NAV_LABEL_KEYS: Record<string, string> = {
  Dashboard: 'nav.dashboard',
  Housekeeping: 'nav.housekeeping',
  'My Rooms': 'nav.myRooms',
  Engineering: 'nav.engineering',
  'Work Orders': 'nav.workOrders',
  Assets: 'nav.assets',
  'PM Schedules': 'nav.pmSchedules',
  Predictions: 'nav.predictions',
  'Lost & Found': 'nav.lostFound',
  'Guest Requests': 'nav.guestRequests',
  Tasks: 'nav.tasks',
  'AI Copilot': 'nav.aiCopilot',
  'SOP Library': 'nav.sopLibrary',
  Reports: 'nav.reports',
  Logbook: 'nav.logbook',
  Staff: 'nav.staff',
  Schedule: 'nav.schedule',
  Settings: 'nav.settings',
  'Room Board': 'nav.roomBoard',
  Assignments: 'nav.assignments',
  Inspections: 'nav.inspections',
}

const OPERATIONS_HREFS  = ['/dashboard','/housekeeping','/engineering','/lost-found','/guest-requests','/tasks']
const INTELLIGENCE_HREFS = ['/ai','/sop','/reports']
const PEOPLE_HREFS       = ['/staff','/scheduling','/logbook']

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const { role } = useRole()
  const { user } = useAuth()
  const { hotel, hotels, setHotel } = useHotelStore()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)
  const reducedMotion = useReducedMotion()
  const [hotelDropdownOpen, setHotelDropdownOpen] = useState(false)
  const hotelDropdownRef = useRef<HTMLDivElement>(null)

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email || 'User'

  const initials  = getInitials(fullName)
  const avatarBg  = getAvatarColor(fullName)
  const roleLabel = role ? t(ROLE_LABELS[role]) : null
  const navLabel = (label: string) => t(NAV_LABEL_KEYS[label] ?? label)

  const allowedHrefs: string[] =
    customRoleModules
      ? ['/dashboard', ...customRoleModules.map(m => `/${m}`)]
      : role === 'front_desk'
      ? ['/dashboard', ...(hotel?.front_desk_modules ?? ['housekeeping','lost-found','tasks','logbook']).map(m => `/${m}`)]
      : role ? NAV_BY_ROLE[role] : []

  const visibleNavItems = role
    ? ALL_NAV_ITEMS.filter(item => allowedHrefs.includes(item.href))
        .map(item =>
          item.href === '/housekeeping' && role === 'housekeeper'
            ? { ...item, label: 'My Rooms' }
            : item.href === '/housekeeping'
            ? {
                ...item,
                subNav: getHousekeepingSubNavItems(role),
              }
            : item
        )
    : ALL_NAV_ITEMS

  const settingsItem: NavItem = { href: '/settings', label: 'Settings', icon: Settings }
  const bottomItems = role === 'gm' ? [settingsItem] : []

  const opsItems   = visibleNavItems.filter(i => OPERATIONS_HREFS.includes(i.href))
  const intelItems = visibleNavItems.filter(i => INTELLIGENCE_HREFS.includes(i.href))
  const peopleItems = visibleNavItems.filter(i => PEOPLE_HREFS.includes(i.href))

  useEffect(() => {
    if (!hotelDropdownOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (hotelDropdownRef.current && !hotelDropdownRef.current.contains(e.target as Node)) {
        setHotelDropdownOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setHotelDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [hotelDropdownOpen])

  const renderNavItem = ({ href, label, icon: Icon, subNav, tag }: NavItem) => {
    const active     = pathname === href || pathname.startsWith(href + '/')
    const subNavOpen = subNav && (pathname === href || pathname.startsWith(href + '/'))

    return (
      <div key={href}>
        <div className="relative">
          {active && (
            <motion.span
              layoutId="sidebar-rail-active"
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 40 }}
              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-accent rounded-full"
            />
          )}
          <Link
            href={href}
            prefetch={false}
            onClick={onMobileClose}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 pl-3.5 pr-3 py-2 text-[13px] rounded-lg transition-colors duration-base ease-out-soft',
              active
                ? 'bg-shell-raised font-medium text-shell-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-shell-ink-2 hover:bg-shell-surface hover:text-shell-ink'
            )}
          >
            <Icon className={cn('w-4 h-4 shrink-0 transition-colors duration-base', active ? 'text-accent' : 'text-shell-ink-3 group-hover:text-shell-ink-2')} strokeWidth={1.75} />
            <span className="flex-1">{navLabel(label)}</span>
            {tag && (
              <span className="text-[9px] font-bold tracking-wide px-1.5 py-px rounded bg-[var(--ai)]/25 text-[#cbb8f0] border border-[var(--ai)]/40">
                {tag}
              </span>
            )}
          </Link>
        </div>
        {subNavOpen && subNav && (
          <div className="anim-fade mt-0.5 ml-4 pl-3 border-l border-shell-line space-y-px">
            {subNav.map(({ href: subHref, label: subLabel }) => {
              const subActive = pathname === subHref || (subHref !== href && pathname.startsWith(subHref + '/'))
              return (
                <Link
                  key={subHref}
                  href={subHref}
                  prefetch={false}
                  onClick={onMobileClose}
                  className={cn(
                    'flex items-center min-h-[36px] px-2.5 py-1.5 text-[12px] rounded-md transition-colors duration-base',
                    subActive
                      ? 'bg-shell-raised text-accent font-medium'
                      : 'text-shell-ink-3 hover:bg-shell-surface hover:text-shell-ink-2'
                  )}
                >
                  {navLabel(subLabel)}
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
        'bg-shell text-shell-ink flex flex-col shrink-0',
        'fixed inset-y-0 left-0 z-40 w-[248px] transition-transform duration-300 ease-out-soft',
        'md:relative md:w-[240px] md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[9px] bg-accent flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M4 21V8l8-5 8 5v13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 21v-6h6v6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
            </svg>
          </div>
          <div className="leading-none">
            <div className="text-[14.5px] font-semibold tracking-tight text-shell-ink">PatelRep</div>
            <div className="text-[10px] text-shell-ink-3 font-mono mt-1">{t('nav.hotelOperationsAI')}</div>
          </div>
        </div>
      </div>

      {/* Hotel switcher */}
      {hotel && (
        <div
          ref={hotelDropdownRef}
          className="relative mx-3 mb-3"
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={hotelDropdownOpen}
            onClick={() => setHotelDropdownOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-[10px] border border-shell-line bg-shell-surface px-2.5 py-2 text-left transition-colors duration-base hover:bg-shell-raised"
          >
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-white text-[10px] font-bold font-display shrink-0">
            {hotel.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-none">
            <div className="text-xs font-semibold text-shell-ink truncate">{hotel.name}</div>
            <div className="text-[10px] text-shell-ink-3 font-mono mt-1">{t('common.rooms', { count: hotel.room_count ?? 0 })}</div>
          </div>
          <ChevronDown className={cn('w-3 h-3 text-shell-ink-3 shrink-0 transition-transform duration-base', hotelDropdownOpen && 'rotate-180')} />
          </button>
          {hotelDropdownOpen && (
            <div
              role="menu"
              className="anim-scale-in absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-shell-line bg-shell-raised p-1.5 shadow-pop"
              onClick={(e) => e.stopPropagation()}
            >
              {(hotels.length ? hotels : [hotel]).map((item) => {
                const active = item.id === hotel.id
                return (
                  <button
                    key={item.id}
                    role="menuitem"
                    onClick={() => {
                      setHotel(item)
                      setHotelDropdownOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-base hover:bg-shell-surface',
                      active ? 'text-accent' : 'text-shell-ink-2'
                    )}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">
                      {item.name[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{item.name}</span>
                      <span className="block font-mono text-[10px] text-shell-ink-3">{t('common.rooms', { count: item.room_count ?? 0 })}</span>
                    </span>
                  </button>
                )
              })}
              <button
                role="menuitem"
                onClick={() => {
                  setHotelDropdownOpen(false)
                  router.push('/settings')
                  onMobileClose?.()
                }}
                className="mt-1 flex w-full items-center justify-center rounded-lg border border-shell-line px-2.5 py-2 text-[12px] font-medium text-shell-ink-2 transition-colors duration-base hover:bg-shell-surface hover:text-shell-ink"
              >
                {t('nav.manageHotelProfile')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 px-3 overflow-y-auto space-y-4 [scrollbar-color:var(--shell-line)_transparent]">
        {opsItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-shell-ink-3 px-2 pt-1 pb-1.5">{t('nav.operations')}</p>
            <div className="space-y-px">{opsItems.map(renderNavItem)}</div>
          </div>
        )}
        {intelItems.length > 0 && (
          <div>
            <div className="mx-1 mb-2.5 border-t border-shell-line/60" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-shell-ink-3 px-2 pb-1.5">{t('nav.intelligence')}</p>
            <div className="space-y-px">{intelItems.map(renderNavItem)}</div>
          </div>
        )}
        {peopleItems.length > 0 && (
          <div>
            <div className="mx-1 mb-2.5 border-t border-shell-line/60" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-shell-ink-3 px-2 pb-1.5">{t('nav.organization')}</p>
            <div className="space-y-px">{peopleItems.map(renderNavItem)}</div>
          </div>
        )}
      </nav>

      {/* Settings / Billing */}
      {bottomItems.length > 0 && (
        <div className="px-3 pt-2 pb-1 border-t border-shell-line/60 space-y-px">
          {bottomItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <div key={href} className="relative">
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-accent rounded-full" />}
                <Link
                  href={href}
                  prefetch={false}
                  onClick={onMobileClose}
                  className={cn(
                    'group flex items-center gap-2.5 pl-3.5 pr-3 py-2 text-[13px] rounded-lg transition-colors duration-base',
                    active
                      ? 'bg-shell-raised font-medium text-shell-ink'
                      : 'text-shell-ink-2 hover:bg-shell-surface hover:text-shell-ink'
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-accent' : 'text-shell-ink-3')} strokeWidth={1.75} />
                  {navLabel(label)}
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* User identity */}
      <div className="px-3 pb-4 pt-2 border-t border-shell-line/60">
        <LanguageToggle className="mb-2 flex w-full justify-center sm:hidden border-shell-line bg-shell-surface text-shell-ink-2 hover:bg-shell-raised hover:text-shell-ink" />
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-shell-surface border border-shell-line">
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0', avatarBg)}>
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-shell-ink truncate leading-tight">{fullName}</p>
            {roleLabel && <p className="text-[10px] text-shell-ink-3 truncate leading-tight mt-0.5">{roleLabel}</p>}
          </div>
        </div>
      </div>
    </aside>
  )
}
