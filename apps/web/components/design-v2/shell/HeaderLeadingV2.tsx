'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, ChevronRight, Menu, Search } from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { useHotelStore } from '@/stores/hotelStore'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'
import { ALL_NAV_ITEMS, NAV_LABEL_KEYS, SETTINGS_NAV_ITEM } from '@/lib/utils/navigation'
import styles from './shellV2.module.css'

/** Where am I: "Section" or "Section > Page" for the current route. Uses the same nav tables as the
 *  legacy breadcrumb, so it can never name a destination the person cannot reach. */
export function useRouteContext(): { section: { href: string; label: string } | null; page: string | null } {
  const pathname = usePathname()
  const { t } = useTranslation()
  const { role } = useRole()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return { section: null, page: null }
  const parentHref = `/${segments[0]}`
  const parent = [...ALL_NAV_ITEMS, SETTINGS_NAV_ITEM].find((item) => item.href === parentHref)
  if (!parent) return { section: null, page: null }
  const section = { href: parentHref, label: t(NAV_LABEL_KEYS[parent.label] ?? parent.label) }
  if (segments.length < 2) return { section, page: null }
  const subNav = parentHref === '/housekeeping' ? getHousekeepingSubNavItems(role) : parent.subNav
  const sub = subNav?.find((item) => item.href === pathname)
  const raw = sub ? sub.label : segments[1]
  return { section, page: t(NAV_LABEL_KEYS[raw] ?? raw) }
}

interface Props {
  onOpenMenu: () => void
}

/** Left side of the V2 header: the small-screen menu button, a route trail, the property and the
 *  search entry. The bell, language toggle and account menu are the existing Header's. */
export const HeaderLeadingV2 = forwardRef<HTMLButtonElement, Props>(function HeaderLeadingV2({ onOpenMenu }, menuRef) {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const { section, page } = useRouteContext()
  const openSearch = () => document.dispatchEvent(new CustomEvent('command-palette:open'))

  return (
    <div className={styles.leading}>
      <button
        ref={menuRef}
        type="button"
        className={styles.menuButton}
        onClick={onOpenMenu}
        aria-label={t('header.openMenu')}
        aria-haspopup="dialog"
        data-testid="shell-v2-menu"
      >
        <Menu size={22} aria-hidden />
      </button>

      {hotel?.name ? (
        <div className={styles.property} data-testid="shell-v2-property" title={hotel.name}>
          <Building2 size={16} aria-hidden />
          <span className={styles.propertyName}>
            <span className={styles.srOnly}>{t('shellV2.property')}: </span>
            {hotel.name}
          </span>
        </div>
      ) : null}

      {section ? (
        <nav aria-label={t('shellV2.youAreHere')} className={styles.context} data-testid="shell-v2-context">
          {page ? (
            <>
              <Link href={section.href} prefetch={false} className={styles.contextLink}>
                {section.label}
              </Link>
              <ChevronRight size={14} aria-hidden className={styles.contextSep} />
              <span className={styles.contextCurrent} aria-current="page">
                {page}
              </span>
            </>
          ) : (
            <span className={styles.contextCurrent} aria-current="page">
              {section.label}
            </span>
          )}
        </nav>
      ) : null}

      <button
        type="button"
        className={styles.searchButton}
        onClick={openSearch}
        aria-label={t('header.openCommandPalette')}
        data-testid="shell-v2-search"
      >
        <Search size={18} aria-hidden />
        <span className={styles.searchText}>{t('header.searchPlaceholder')}</span>
        <kbd className={styles.kbd} aria-hidden>
          Ctrl K
        </kbd>
      </button>
    </div>
  )
})
