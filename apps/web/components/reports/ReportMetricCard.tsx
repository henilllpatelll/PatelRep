'use client'

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { AVAILABILITY_TEXT, directionText, formatChange, formatValue } from '@/lib/reports/format'
import type { Kpi, MetricDefinition } from '@/lib/reports/types'
import { InfoTip, LiveBadge, LowSampleBadge } from './ReportPrimitives'

const DIRECTION_STYLE = {
  favorable: 'text-[var(--ready)]',
  unfavorable: 'text-[var(--alert)]',
  neutral: 'text-ink3',
} as const

/**
 * One KPI. Carries label, value, unit, comparison (with direction as TEXT, not colour alone),
 * availability reason, eligible-record count, definition tooltip and live/low-sample flags.
 * Only becomes interactive when an `onOpen` handler is supplied AND there is a value to explain.
 */
export function ReportMetricCard({
  kpi,
  definition,
  onOpen,
  hideComparison,
  className,
}: {
  kpi: Kpi
  definition?: MetricDefinition
  onOpen?: () => void
  hideComparison?: boolean
  className?: string
}) {
  const available = kpi.value !== null && kpi.availability === 'available'
  const comparison = kpi.comparison
  const DirectionIcon = comparison?.direction === 'neutral' ? ArrowRight : (comparison?.change ?? 0) > 0 ? ArrowUpRight : ArrowDownRight
  const interactive = !!onOpen && available

  return (
    <Card
      hover={false}
      className={cn('report-avoid-break relative flex min-h-[116px] flex-col justify-between p-4', interactive && 'transition-shadow hover:shadow-card-hover', className)}
    >
      {/* A real button stretched over the card (not a role=button wrapper), so the definition tooltip
          button inside the card is never a nested interactive control. */}
      {interactive && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${kpi.label}: ${formatValue(kpi.value, kpi.unit)}. Open details`}
          className="absolute inset-0 z-0 rounded-[var(--r-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 print:hidden"
        />
      )}
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12.5px] font-medium leading-snug text-ink2">{kpi.label}</p>
          {definition && (
            <span className="relative z-10">
              <InfoTip label={`About ${kpi.label}`}>
                <strong className="block text-ink">{definition.label}</strong>
                {definition.definition}
              </InfoTip>
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {available ? (
            <span className="font-display text-[28px] leading-none tracking-tight text-ink">{formatValue(kpi.value, kpi.unit)}</span>
          ) : (
            <span className="text-[15px] font-medium text-ink2">{AVAILABILITY_TEXT[kpi.availability === 'available' ? 'unavailable' : kpi.availability]}</span>
          )}
          {kpi.scope === 'live' && <LiveBadge />}
          {kpi.low_sample && <LowSampleBadge n={kpi.sample_size} />}
        </div>
      </div>
      <div className="mt-2 space-y-0.5 text-[12px] leading-snug">
        {!hideComparison && comparison && available && (
          <p className={cn('flex flex-wrap items-center gap-1', DIRECTION_STYLE[comparison.direction])}>
            <DirectionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="font-medium">{formatChange(comparison)}</span>
            <span className="text-ink3">
              vs {formatValue(comparison.previous, kpi.unit)} · {directionText(comparison)}
            </span>
          </p>
        )}
        {kpi.eligible !== null && kpi.eligible !== undefined && available && kpi.numerator !== null && (
          <p className="text-ink3">
            {kpi.numerator} of {kpi.eligible} eligible
          </p>
        )}
        {kpi.note && <p className="text-ink3">{kpi.note}</p>}
      </div>
    </Card>
  )
}
