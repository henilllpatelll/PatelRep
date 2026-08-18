'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Breadcrumbs } from './Breadcrumbs'
import type { ReactNode } from 'react'

interface Tab {
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
  /** Per-tab override — see PageHeaderProps.dataI18nSkip. Independent of the page-level prop since some callers (e.g. static category tabs) must keep relying on the legacy translator while their new title/subtitle must not. */
  dataI18nSkip?: boolean
}

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  meta?: ReactNode
  actions?: ReactNode
  tabs?: Tab[]
  className?: string
  /**
   * Opt-in escape hatch for callers whose title/subtitle/tab labels come from
   * react-i18next content the legacy page-wide DOM translator (domTranslations.ts,
   * predates react-i18next) doesn't recognize as a whole phrase — it partially
   * glossary-matches individual words in the recovered "original" and re-mangles
   * already-correct Spanish into English/Spanish hybrids. Defaults to off so every
   * other PageHeader caller keeps relying on the legacy translator unchanged.
   */
  dataI18nSkip?: boolean
}

export function PageHeader({ eyebrow, title, subtitle, meta, actions, tabs, className, dataI18nSkip }: PageHeaderProps) {
  const pathname = usePathname()
  const isSubRoute = pathname.split('/').filter(Boolean).length >= 2

  return (
    <div className={cn('pb-0', className)} data-testid="page-header">
      <div className="flex justify-between items-end gap-6">
        <div className="flex-1 min-w-0">
          {isSubRoute ? (
            <div className="mb-2">
              <Breadcrumbs />
            </div>
          ) : (
            eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3 mb-2">
                {eyebrow}
              </p>
            )
          )}
          <h1
            className="font-display text-[34px] font-normal tracking-[-0.5px] leading-[1.1] text-ink"
            data-i18n-skip={dataI18nSkip ? 'true' : undefined}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="mt-2 text-[14px] text-ink2 max-w-[640px] leading-[1.45]"
              data-i18n-skip={dataI18nSkip ? 'true' : undefined}
            >
              {subtitle}
            </p>
          )}
          {meta && (
            <div className="flex items-center gap-3.5 mt-3">{meta}</div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 pb-1 shrink-0">{actions}</div>
        )}
      </div>

      {tabs && (
        <div className="flex mt-4 border-b border-line -mb-px">
          {tabs.map((tab, i) => (
            <button
              key={i}
              onClick={tab.onClick}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] border-b-2 transition-colors',
                tab.active
                  ? 'font-semibold text-ink border-accent'
                  : 'font-medium text-ink3 border-transparent hover:text-ink2'
              )}
            >
              <span data-i18n-skip={tab.dataI18nSkip ? 'true' : undefined}>{tab.label}</span>
              {tab.count != null && (
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-px rounded-full',
                  tab.active
                    ? 'bg-[var(--accent-soft)] text-accent'
                    : 'bg-surface-3 text-ink3'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
