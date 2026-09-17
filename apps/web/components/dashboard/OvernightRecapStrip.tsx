'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { AILabel } from '@/components/ui/primitives'
import { logbookApi } from '@/lib/api/logbook'
import type { OvernightSummary } from '@/lib/hooks/useArrivalReadiness'

interface OvernightRecapStripProps {
  summary: OvernightSummary | null
  isLoading: boolean
}

export function OvernightRecapStrip({ summary, isLoading }: OvernightRecapStripProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => logbookApi.acknowledgeShiftSummary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gm-overnight-summary'] })
      queryClient.invalidateQueries({ queryKey: ['overnight-shift-summary'] })
    },
  })

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
          {summary.acknowledgedAt ? (
            <span
              className="text-[11px] text-ink3 shrink-0"
              title={summary.acknowledgedByName ?? undefined}
            >
              ✓ {t('dashboard.gm.acknowledged')}
            </span>
          ) : summary.id ? (
            <button
              type="button"
              onClick={() => acknowledgeMutation.mutate(summary.id as string)}
              disabled={acknowledgeMutation.isPending}
              className="text-[12px] font-medium text-brand shrink-0 disabled:opacity-50"
            >
              {t('dashboard.gm.acknowledge')}
            </button>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-[13px] text-ink3 flex-1 min-w-0">{t('dashboard.gm.noOvernightSummary')}</p>
      )}
    </Card>
  )
}
