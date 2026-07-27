'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { cn } from '@/lib/utils'
import { ALL_NAV_ITEMS, SETTINGS_NAV_ITEM, NAV_LABEL_KEYS } from '@/lib/utils/navigation'
import { getHousekeepingSubNavItems } from '@/lib/utils/housekeepingNavigation'

/** Renders in the PageHeader `eyebrow` slot on sub-routes (e.g. Engineering → Work Orders). */
export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const { t } = useTranslation()
  const { role } = useRole()

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const parentHref = `/${segments[0]}`
  const parentItem = [...ALL_NAV_ITEMS, SETTINGS_NAV_ITEM].find((item) => item.href === parentHref)
  if (!parentItem) return null

  const parentLabel = t(NAV_LABEL_KEYS[parentItem.label] ?? parentItem.label)
  const subNav = parentHref === '/housekeeping' ? getHousekeepingSubNavItems(role) : parentItem.subNav
  const subItem = subNav?.find((sub) => sub.href === pathname)
  const currentLabel = subItem
    ? t(NAV_LABEL_KEYS[subItem.label] ?? subItem.label)
    : t(NAV_LABEL_KEYS[segments[1]] ?? segments[1])

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3', className)}
    >
      <Link href={parentHref} className="transition-colors hover:text-ink2">
        {parentLabel}
      </Link>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="text-ink2">{currentLabel}</span>
    </nav>
  )
}
