'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useRole } from '@/lib/hooks/useRole'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/stores/authStore'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'
import {
  ALL_NAV_ITEMS, SETTINGS_NAV_ITEM, NAV_LABEL_KEYS,
  MORE_NAV_HREFS, PRIMARY_NAV_HREFS,
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
  const { t } = useTranslation()
  const { role } = useRole()
  const { user } = useAuth()
  const { hotel } = useHotelStore()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)
  const [isHovering, setIsHovering] = useState(false)
  const sidebarCollapsed = !isHovering

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

  const primaryItems = visibleNavItems.filter((item) => PRIMARY_NAV_HREFS.includes(item.href))
  const moreItems = visibleNavItems.filter((item) => MORE_NAV_HREFS.includes(item.href))

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

  const renderTailGroup = (label: string, items: NavItem[]) => {
    if (items.length === 0) return null
    return (
      <div key={label} className="flex pt-3.5 mt-3 border-t border-line">
        <div className="w-[58px] shrink-0 pt-1.5 pl-1">
          <p className="m-0 text-[9.5px] font-semibold uppercase tracking-[0.11em] text-ink4 leading-snug">{label}</p>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          {items.map(({ href, label: itemLabel, tag }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                onClick={onMobileClose}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 px-2 py-[5px] rounded-md text-[12.5px] leading-tight',
                  active ? 'bg-surface font-medium text-ink' : 'text-ink2 hover:bg-surface-3 hover:text-ink'
                )}
              >
                <span className="flex-1">{navLabel(itemLabel)}</span>
                {tag && (
                  <span className="text-[8px] font-bold tracking-wide px-1 py-px rounded bg-ai-soft text-ai border border-ai-line">
                    {tag}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside
      aria-label="Main navigation"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={cn(
        'bg-paper border-r border-line flex flex-col shrink-0',
        'fixed inset-y-0 left-0 z-40 w-[240px] transition-transform duration-300 ease-in-out',
        'md:relative md:translate-x-0 md:transition-[width] md:duration-base md:ease-standard',
        sidebarCollapsed ? 'md:w-16' : 'md:w-[232px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* Dashboard brand */}
      <div className="px-3.5 pt-4 pb-3">
        <Link
          href="/dashboard"
          prefetch={false}
          onClick={onMobileClose}
          aria-label={t('nav.dashboard')}
          className="flex items-center gap-2.5 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
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
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {sidebarCollapsed ? (
          <div className="space-y-px">
            {[...primaryItems, ...moreItems].map(renderNavItem)}
          </div>
        ) : (
          <>
            {primaryItems.length > 0 && (
              <div className="space-y-px">
                {primaryItems.map(renderNavItem)}
              </div>
            )}
            {renderTailGroup(t('nav.tailMore'), moreItems)}
          </>
        )}
      </nav>

      {/* Settings */}
      {bottomItems.length > 0 && (
        <div className="mt-4 px-3 pt-2 pb-1 border-t border-line-2 space-y-px">
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
