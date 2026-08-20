'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/Card'
import { AILabel } from '@/components/ui/primitives'
import type { OvernightSummary } from '@/lib/hooks/useArrivalReadiness'

interface OvernightRecapStripProps {
  summary: OvernightSummary | null
  isLoading: boolean
}

export function OvernightRecapStrip({ summary, isLoading }: OvernightRecapStripProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return <div className="h-[52px] rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
  }

  return (
    <Card hover={false} className="px-4 py-3.5 flex items-center gap-4">
      <AILabel className="shrink-0" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 shrink-0">
        {t('dashboard.gm.overnightTitle')}
      </span>
      {summary ? (
        <>
          <p className="m-0 text-[13px] text-ink2 flex-1 min-w-0 truncate">{summary.text}</p>
          <Link href={summary.href} className="text-[12px] font-medium text-brand shrink-0">
            {t('dashboard.gm.readFullRecap')}
          </Link>
        </>
      ) : (
        <p className="m-0 text-[13px] text-ink3 flex-1 min-w-0">{t('dashboard.gm.noOvernightSummary')}</p>
      )}
    </Card>
  )
}
