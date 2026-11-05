'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft, ChevronsRight, UserCog } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/hooks/useAuth'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { getInitials } from '@/lib/utils/avatar'
import { buildShellNavGroups } from '@/lib/design/shellNav'
import { NAV_LABEL_KEYS, SETTINGS_NAV_ITEM, type NavItem } from '@/lib/utils/navigation'
import { canAccessSettings } from '@/lib/settings/navigation'
import { PREFERENCES_HREF } from '@/lib/settings/preferences'
import styles from './shellV2.module.css'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Right-side tooltip on a collapsed rail item; transparent otherwise. The bar keeps an accessible
 *  name regardless (see `navLabel` as visually-hidden text), so the tooltip is purely visual help for
 *  pointer and keyboard-focus users. */
function RailTooltip({ rail, label, themeVars, children }: { rail: boolean; label: string; themeVars: React.CSSProperties; children: React.ReactElement }) {
  if (!rail) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={10} className={styles.tooltip} style={themeVars}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export interface SidebarContentProps {
  /** Icon-only rail. */
  rail: boolean
  themeVars: React.CSSProperties
  /** Called after any navigation click (closes the drawer). */
  onNavigate?: () => void
  /** Show the collapse toggle (desktop sidebar only). */
  onToggleRail?: () => void
  /** The rail is forced by viewport width, so the user toggle is hidden. */
  railForced?: boolean
}

export function SidebarContent({ rail, themeVars, onNavigate, onToggleRail, railForced }: SidebarContentProps) {
  const pathname = usePathname()
  const { t } = useTranslation()
  const { role } = useRole()
  const { user } = useAuth()
  const hotel = useHotelStore((s) => s.hotel)
  const customRoleModules = useAuthStore((s) => s.customRoleModules)
  const baseRole = useAuthStore((s) => s.role)

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email ||
    'User'
  const navLabel = (label: string) => t(NAV_LABEL_KEYS[label] ?? label)
  const groups = buildShellNavGroups({ role, customRoleModules, frontDeskModules: hotel?.front_desk_modules ?? null })
  const showSettings = canAccessSettings(baseRole ?? role)

  const renderItem = ({ href, label, icon: Icon, subNav, tag }: NavItem) => {
    const active = isActive(pathname, href)
    const text = navLabel(label)
    const link = (
      <Link
        href={href}
        prefetch={false}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cx(styles.navLink, rail && styles.navLinkRail, active && styles.navLinkActive)}
      >
        <Icon size={20} aria-hidden className={styles.navIcon} />
        <span className={rail ? styles.srOnly : styles.navLabel}>{text}</span>
        {tag && !rail ? <span className={styles.navTag}>{tag}</span> : null}
      </Link>
    )
    return (
      <li key={href}>
        <RailTooltip rail={rail} label={text} themeVars={themeVars}>
          {link}
        </RailTooltip>
        {active && subNav && !rail ? (
          <ul className={styles.subNav}>
            {subNav.map((sub) => {
              const subActive = pathname === sub.href || (sub.href !== href && pathname.startsWith(`${sub.href}/`))
              return (
                <li key={sub.href}>
                  <Link
                    href={sub.href}
                    prefetch={false}
                    onClick={onNavigate}
                    aria-current={subActive ? 'page' : undefined}
                    className={cx(styles.subLink, subActive && styles.subLinkActive)}
                  >
                    {navLabel(sub.label)}
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : null}
      </li>
    )
  }

  const settingsActive = isActive(pathname, SETTINGS_NAV_ITEM.href)
  const SettingsIcon = SETTINGS_NAV_ITEM.icon
  const settingsLabel = navLabel(SETTINGS_NAV_ITEM.label)
  const prefsActive = pathname === PREFERENCES_HREF
  const prefsLabel = t('header.myPreferences')

  return (
    <>
      <div className={cx(styles.sideTop, rail && styles.sideTopRail)}>
        <Link
          href="/dashboard"
          prefetch={false}
          onClick={onNavigate}
          aria-label={t('nav.dashboard')}
          className={cx(styles.brand, rail && styles.brandRail)}
        >
          <span className={styles.logo} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 21V8l8-5 8 5v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {!rail ? (
            <span className={styles.brandText}>
              <span>PatelRep</span>
              <span className={styles.brandSub}>{t('nav.hotelOperationsAI')}</span>
            </span>
          ) : null}
        </Link>
      </div>

      <nav aria-label={t('shellV2.mainNavigation')} className={styles.navScroll}>
        {groups.map((group, index) => (
          <div key={group.id} className={styles.group}>
            {index > 0 ? <div className={styles.groupRule} aria-hidden /> : null}
            {group.id !== 'overview' ? (
              <p className={cx(styles.groupLabel, rail && styles.groupLabelRail)}>{t(group.labelKey)}</p>
            ) : null}
            <ul className={styles.navList}>{group.items.map(renderItem)}</ul>
          </div>
        ))}
      </nav>

      <div className={styles.sideBottom}>
        <ul className={styles.navList}>
          <li>
            <RailTooltip rail={rail} label={prefsLabel} themeVars={themeVars}>
              <Link
                href={PREFERENCES_HREF}
                prefetch={false}
                onClick={onNavigate}
                aria-current={prefsActive ? 'page' : undefined}
                className={cx(styles.navLink, rail && styles.navLinkRail, prefsActive && styles.navLinkActive)}
              >
                <UserCog size={20} aria-hidden className={styles.navIcon} />
                <span className={rail ? styles.srOnly : styles.navLabel}>{prefsLabel}</span>
              </Link>
            </RailTooltip>
          </li>
          {showSettings ? (
            <li>
              <RailTooltip rail={rail} label={settingsLabel} themeVars={themeVars}>
                <Link
                  href={SETTINGS_NAV_ITEM.href}
                  prefetch={false}
                  onClick={onNavigate}
                  aria-current={settingsActive ? 'page' : undefined}
                  className={cx(styles.navLink, rail && styles.navLinkRail, settingsActive && styles.navLinkActive)}
                >
                  <SettingsIcon size={20} aria-hidden className={styles.navIcon} />
                  <span className={rail ? styles.srOnly : styles.navLabel}>{settingsLabel}</span>
                </Link>
              </RailTooltip>
            </li>
          ) : null}
          {onToggleRail && !railForced ? (
            <li>
              <RailTooltip rail={rail} label={t('shellV2.expandSidebar')} themeVars={themeVars}>
                <button
                  type="button"
                  onClick={onToggleRail}
                  aria-expanded={!rail}
                  aria-label={rail ? t('shellV2.expandSidebar') : t('shellV2.collapseSidebar')}
                  className={cx(styles.navLink, rail && styles.navLinkRail)}
                  data-testid="shell-v2-collapse"
                >
                  {rail ? <ChevronsRight size={20} aria-hidden /> : <ChevronsLeft size={20} aria-hidden />}
                  {!rail ? <span className={styles.navLabel}>{t('shellV2.collapseSidebar')}</span> : null}
                </button>
              </RailTooltip>
            </li>
          ) : null}
        </ul>
        <div className={cx(styles.identity, rail && styles.identityRail)}>
          <span className={styles.avatar} aria-hidden>
            {getInitials(fullName)}
          </span>
          {!rail ? (
            <span className={styles.identityText}>
              <span className={styles.identityName}>{fullName}</span>
              {role ? <span className={styles.identityRole}>{t(`roles.${role}`)}</span> : null}
            </span>
          ) : (
            <span className={styles.srOnly}>{fullName}</span>
          )}
        </div>
      </div>
    </>
  )
}
