'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { SectionLabel, Mono, Pill } from '@/components/ui/primitives'
import type { BlockerRow } from '@/lib/hooks/useArrivalReadiness'

const VISIBLE_CAP = 6

interface RoomBlockersListProps {
  rows: BlockerRow[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function RoomBlockersList({ rows, isLoading, isError, onRetry }: RoomBlockersListProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, VISIBLE_CAP)
  const overflow = rows.length - VISIBLE_CAP

  const status = isLoading ? 'loading' : isError ? 'error' : null

  return (
    <Card hover={false} className="p-4">
      <SectionLabel
        hint={rows.length > 0 ? rows.length : undefined}
        action={
          <Link href="/engineering/work-orders" className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors">
            {t('dashboard.gm.viewAllWorkOrders')}
          </Link>
        }
      >
        {t('dashboard.gm.blockersTitle')}
      </SectionLabel>

      <StateBlock status={status} error={{ message: t('common.error'), onRetry }}>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-[var(--r-md)] bg-surface-3 animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ready-soft)] text-[var(--ready)]">
              <Check className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <p className="text-[14px] font-medium text-ink">{t('dashboard.gm.blockersEmpty')}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {visible.map((row, i) => (
              <Link
                key={row.id}
                href={row.href}
                className={`flex items-center gap-3 py-3 hover:bg-surface-2 transition-colors -mx-1 px-1 rounded-sm ${
                  i < visible.length - 1 ? 'border-b border-line-2' : ''
                }`}
              >
                <Mono className="bg-surface-2 border border-line rounded-[6px] px-2 py-0.5 text-[13px] font-semibold shrink-0">
                  {row.roomNumber}
                </Mono>
                <div className="flex-1 min-w-0">
                  <p className="m-0 text-[13px] text-ink truncate">{row.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink3 truncate">{row.meta}</p>
                </div>
                <Pill tone={row.pillTone} size="sm" className="shrink-0">
                  {row.pillLabel}
                </Pill>
              </Link>
            ))}
            {!expanded && overflow > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-2 self-start text-[11px] font-medium text-ink3 hover:text-brand transition-colors"
              >
                {t('dashboard.gm.moreBlockers', { count: overflow })}
              </button>
            )}
          </div>
        )}
      </StateBlock>
    </Card>
  )
}
