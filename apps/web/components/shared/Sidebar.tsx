'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown, ChevronUp, PanelLeft, PanelLeftClose } from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/stores/authStore'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'
import {
  ALL_NAV_ITEMS, SETTINGS_NAV_ITEM, NAV_LABEL_KEYS,
  OPERATIONS_HREFS, INTELLIGENCE_HREFS, PEOPLE_HREFS,
  getAllowedNavItems, type NavItem,
} from '@/lib/utils/navigation'
import { LanguageToggle } from '@/components/shared/LanguageToggle'
import { useTranslation } from 'react-i18next'

const ROLE_LABELS: Record<UserRole, string> = {
  gm:                      'roles.gm',
  housekeeping_supervisor: 'roles.housekeeping_supervisor',
  housekeeper:             'roles.housekeeper',
  engineer:                'roles.engineer',
  chief_engineer:          'roles.chief_engineer',
  front_desk:              'roles.front_desk',
}

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
  redesigned?: boolean
}

/** Wraps `children` (a single focusable element) in a right-side tooltip when `collapsed`; passes through untouched otherwise. Tooltip.Content is hidden below `md` as a defensive no-op on touch/mobile. */
function CollapsedTooltip({ collapsed, label, children }: { collapsed: boolean; label: string; children: React.ReactElement }) {
  if (!collapsed) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="z-tooltip hidden rounded-[var(--r-md)] bg-ink px-2 py-1 text-[12px] text-paper shadow-pop md:block"
        >
          {label}
          <Tooltip.Arrow className="fill-ink" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Sidebar({ mobileOpen = false, onMobileClose, redesigned }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const { role } = useRole()
  const { user } = useAuth()
  const { hotel, hotels, setHotel } = useHotelStore()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIPreferencesStore()
  const [hotelDropdownOpen, setHotelDropdownOpen] = useState(false)
  const hotelDropdownRef = useRef<HTMLDivElement>(null)
  const [opsOpen, setOpsOpen] = useState(true)
  const [intelOpen, setIntelOpen] = useState(true)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email || 'User'

  const initials  = getInitials(fullName)
  const avatarBg  = getAvatarColor(fullName)
  const roleLabel = role ? t(ROLE_LABELS[role]) : null
  const navLabel = (label: string) => t(NAV_LABEL_KEYS[label] ?? label)

  const activeBarClass  = redesigned ? 'bg-brand' : 'bg-accent'
  const activeIconClass = redesigned ? 'text-brand' : 'text-accent'
  const linkTransitionClass = redesigned
    ? 'transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'
    : 'transition-colors duration-150'

  const visibleNavItems = role
    ? getAllowedNavItems({ role, customRoleModules, frontDeskModules: hotel?.front_desk_modules ?? null })
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

  const bottomItems = role === 'gm' ? [SETTINGS_NAV_ITEM] : []

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

    const link = (
      <Link
        href={href}
        prefetch={false}
        onClick={onMobileClose}
        aria-current={active ? 'page' : undefined}
        aria-label={sidebarCollapsed ? navLabel(label) : undefined}
        className={cn(
          'group flex items-center gap-2.5 pl-3.5 pr-3 py-[7px] text-[13px] rounded-lg',
          linkTransitionClass,
          sidebarCollapsed && 'md:justify-center md:px-0',
          active
            ? 'bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]'
            : 'text-ink2 hover:bg-surface-2 hover:text-ink'
        )}
      >
        <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? activeIconClass : 'text-ink3')} />
        <span className={cn('flex-1', sidebarCollapsed && 'md:hidden')}>{navLabel(label)}</span>
        {tag && (
          <span className={cn('text-[9px] font-bold tracking-wide px-1.5 py-px rounded bg-ai-soft text-ai border border-ai-line', sidebarCollapsed && 'md:hidden')}>
            {tag}
          </span>
        )}
      </Link>
    )

    return (
      <div key={href}>
        <div className="relative">
          {active && (
            <span className={cn('absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full', activeBarClass)} />
          )}
          <CollapsedTooltip collapsed={sidebarCollapsed} label={navLabel(label)}>
            {link}
          </CollapsedTooltip>
        </div>
        {subNavOpen && subNav && (
          <div className={cn('mt-0.5 ml-3.5 pl-3 border-l border-line-2 space-y-px', sidebarCollapsed && 'md:hidden')}>
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
        'bg-paper border-r border-line flex flex-col shrink-0',
        'fixed inset-y-0 left-0 z-40 w-[240px] transition-transform duration-300 ease-in-out',
        'md:relative md:translate-x-0 md:transition-[width] md:duration-base md:ease-standard',
        sidebarCollapsed ? 'md:w-16' : 'md:w-[232px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Logo + collapse button */}
      <div className="flex items-center justify-between px-3.5 pt-4 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-[7px] bg-ink flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 21V8l8-5 8 5v13" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 21v-6h6v6" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className={cn('leading-none', sidebarCollapsed && 'md:hidden')}>
            <div className="text-sm font-semibold tracking-tight text-ink">PatelRep</div>
            <div className="text-[10px] text-ink3 font-mono mt-0.5">{t('nav.hotelOperationsAI')}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          aria-label={sidebarCollapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          aria-expanded={!sidebarCollapsed}
          className="hidden md:inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 hover:bg-surface-2 hover:text-ink transition-colors"
        >
          {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Hotel switcher */}
      {hotel && (
        <div
          ref={hotelDropdownRef}
          className={cn('relative mx-3 mb-3', sidebarCollapsed && 'md:hidden')}
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={hotelDropdownOpen}
            onClick={() => setHotelDropdownOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
          >
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-white text-[10px] font-bold font-display shrink-0">
            {hotel.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-none">
            <div className="text-xs font-semibold text-ink truncate">{hotel.name}</div>
            <div className="text-[10px] text-ink3 font-mono mt-0.5">{t('common.rooms', { count: hotel.room_count ?? 0 })}</div>
          </div>
          <ChevronDown className={cn('w-3 h-3 text-ink3 shrink-0 transition-transform', hotelDropdownOpen && 'rotate-180')} />
          </button>
          {hotelDropdownOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-line bg-surface p-1.5 shadow-pop"
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
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2',
                      active && 'bg-accent-soft text-accent'
                    )}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">
                      {item.name[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{item.name}</span>
                      <span className="block font-mono text-[10px] text-ink3">{t('common.rooms', { count: item.room_count ?? 0 })}</span>
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
                className="mt-1 flex w-full items-center justify-center rounded-lg border border-line px-2.5 py-2 text-[12px] font-medium text-ink2 hover:bg-surface-2"
              >
                {t('nav.manageHotelProfile')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 px-3 overflow-y-auto space-y-3">
        {opsItems.length > 0 && (
          <div>
            <button
              onClick={() => setOpsOpen(!opsOpen)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4',
                sidebarCollapsed && 'md:hidden'
              )}
            >
              <span>{t('nav.operations')}</span>
              <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', opsOpen && 'rotate-180')} />
            </button>
            {opsOpen && (
              <div className="mt-2 space-y-px">
                {opsItems.map(renderNavItem)}
              </div>
            )}
          </div>
        )}
        {intelItems.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line">
            <button
              onClick={() => setIntelOpen(!intelOpen)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4',
                sidebarCollapsed && 'md:hidden'
              )}
            >
              <span>{t('nav.intelligence')}</span>
              <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', intelOpen && 'rotate-180')} />
            </button>
            {intelOpen && (
              <div className="mt-2 space-y-px">
                {intelItems.map(renderNavItem)}
              </div>
            )}
          </div>
        )}
        {peopleItems.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line">
            <button
              onClick={() => setPeopleOpen(!peopleOpen)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4',
                sidebarCollapsed && 'md:hidden'
              )}
            >
              <span>{t('nav.organization')}</span>
              <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', peopleOpen && 'rotate-180')} />
            </button>
            {peopleOpen && (
              <div className="mt-2 space-y-px">
                {peopleItems.map(renderNavItem)}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Settings / Billing */}
      {bottomItems.length > 0 && (
          <div className="mt-4 px-3 pt-2 pb-1 border-t border-line-2 space-y-px">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-ink4',
                sidebarCollapsed && 'md:hidden'
              )}
            >
              <span>{t('nav.settings')}</span>
              <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', settingsOpen && 'rotate-180')} />
            </button>
            {settingsOpen && (
              <div className="mt-2 space-y-px">
                {bottomItems.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href
                  const link = (
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={onMobileClose}
                      aria-label={sidebarCollapsed ? navLabel(label) : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 pl-3.5 pr-3 py-[7px] text-[13px] rounded-lg',
                        linkTransitionClass,
                        sidebarCollapsed && 'md:justify-center md:px-0',
                        active ? 'bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]' : 'text-ink2 hover:bg-surface-2 hover:text-ink'
                      )}
                    >
                      <Icon className={cn('w-3.5 h-3.5 shrink-0', active ? activeIconClass : 'text-ink3')} />
                      <span className={cn(sidebarCollapsed && 'md:hidden')}>{navLabel(label)}</span>
                    </Link>
                  )
                  return (
                    <div key={href} className="relative">
                      {active && <span className={cn('absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full', activeBarClass)} />}
                      <CollapsedTooltip collapsed={sidebarCollapsed} label={navLabel(label)}>
                        {link}
                      </CollapsedTooltip>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      {/* User identity */}
      <div className="px-3 pb-4 pt-2 border-t border-line-2">
        <LanguageToggle className="mb-2 flex w-full justify-center sm:hidden" />
        <div className={cn('flex items-center gap-2.5 py-2 rounded-xl bg-surface border border-line', sidebarCollapsed ? 'md:justify-center md:px-2' : 'px-2.5')}>
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0', avatarBg)}>
            {initials}
          </div>
          <div className={cn('min-w-0', sidebarCollapsed && 'md:hidden')}>
            <p className="text-[13px] font-medium text-ink truncate leading-tight">{fullName}</p>
            {roleLabel && <p className="text-[10px] text-ink3 truncate leading-tight mt-0.5">{roleLabel}</p>}
          </div>
        </div>
      </div>
    </aside>
  )
}
