'use client'

import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { formatShortDate, formatValue, titleCase } from '@/lib/reports/format'
import type { RankedRow, TrendPoint, TrendSeries } from '@/lib/reports/types'
import { ChartFrame } from './ReportPrimitives'

const ACCENT = 'var(--accent)'
const MUTED = 'var(--ink-4)'

interface ChartRow {
  label: string
  start: string
  end: string
  value: number | null
  compareValue: number | null
  compareLabel: string | null
  sample: number
  index: number
}

function mergeSeries(series: TrendSeries): ChartRow[] {
  const compare = series.comparison?.points ?? []
  return series.points.map((p: TrendPoint, index) => ({
    label: p.bucket,
    start: p.start,
    end: p.end,
    value: p.value,
    compareValue: compare[index]?.value ?? null,
    compareLabel: compare[index]?.bucket ?? null,
    sample: p.sample_size,
    index,
  }))
}

function describe(series: TrendSeries, rows: ChartRow[]): string {
  const withData = rows.filter((r) => r.value !== null)
  if (!withData.length) return 'No data points in this period.'
  const values = withData.map((r) => r.value as number)
  return `${withData.length} of ${rows.length} ${series.granularity}s have data. Lowest ${formatValue(Math.min(...values), series.unit)}, highest ${formatValue(Math.max(...values), series.unit)}. Overall ${formatValue(series.total, series.unit)}.`
}

function TrendTooltip({ active, payload, unit, comparisonLabel }: any) {
  if (!active || !payload?.length) return null
  const row: ChartRow = payload[0].payload
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <p className="font-medium text-ink">{formatShortDate(row.start)}{row.end !== row.start ? ` – ${formatShortDate(row.end)}` : ''}</p>
      <p className="text-ink2">{row.value === null ? 'No data for this period' : formatValue(row.value, unit)}{row.value !== null && row.sample ? ` · n=${row.sample}` : ''}</p>
      {row.compareLabel && (
        <p className="text-ink3">{comparisonLabel}: {row.compareValue === null ? 'No data' : formatValue(row.compareValue, unit)}</p>
      )}
    </div>
  )
}

/**
 * Real, bucketed trend. Missing buckets render as gaps (never zero). Optional comparison line.
 * `onPointClick` is only passed when the point can open a filtered drill-down.
 */
export function ReportTrendChart({
  series,
  height = 240,
  kind = 'line',
  onPointClick,
}: {
  series: TrendSeries
  height?: number
  kind?: 'line' | 'bar' | 'area'
  onPointClick?: (point: { bucket: string; start: string; end: string }) => void
}) {
  const rows = useMemo(() => mergeSeries(series), [series])
  const hasData = rows.some((r) => r.value !== null)
  const percent = series.unit === 'percent'
  const comparisonLabel = series.comparison ? `${series.comparison.period.start} – ${series.comparison.period.end}` : ''
  const clickable = !!onPointClick

  const handleClick = (state: any) => {
    if (!onPointClick) return
    const idx = Number(state?.activeTooltipIndex ?? state?.activeIndex)
    const row = Number.isFinite(idx) ? rows[idx] : undefined
    if (row && row.value !== null) onPointClick({ bucket: row.label, start: row.start, end: row.end })
  }

  const common = { data: rows, margin: { top: 8, right: 12, bottom: 4, left: -8 }, onClick: handleClick }
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
      <XAxis dataKey="label" tickFormatter={(v: string) => formatShortDate(v)} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} minTickGap={24} />
      <YAxis
        domain={percent ? [0, 100] : [0, 'auto']}
        tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
        tickFormatter={(v: number) => (percent ? `${v}%` : String(v))}
        width={44}
        allowDecimals={false}
      />
      <Tooltip content={<TrendTooltip unit={series.unit} comparisonLabel={comparisonLabel} />} />
      {series.comparison && <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />}
    </>
  )

  return (
    <ChartFrame label={series.label} summary={describe(series, rows)} height={height}>
      {!hasData ? (
        <div className="flex h-full items-center justify-center rounded-[var(--r-md)] border border-dashed border-line text-[13px] text-ink3">
          No data points in this period.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart {...common}>
              {axes}
              <Bar dataKey="value" name={series.label} fill={ACCENT} radius={[3, 3, 0, 0]} cursor={clickable ? 'pointer' : undefined} isAnimationActive={false} />
              {series.comparison && <Bar dataKey="compareValue" name="Comparison period" fill={MUTED} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
            </BarChart>
          ) : kind === 'area' ? (
            <AreaChart {...common}>
              {axes}
              <Area dataKey="value" name={series.label} stroke={ACCENT} fill="var(--accent-soft)" connectNulls={false} isAnimationActive={false} />
              {series.comparison && <Area dataKey="compareValue" name="Comparison period" stroke={MUTED} fill="transparent" strokeDasharray="4 3" connectNulls={false} isAnimationActive={false} />}
            </AreaChart>
          ) : (
            <LineChart {...common}>
              {axes}
              <Line dataKey="value" name={series.label} stroke={ACCENT} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5, style: clickable ? { cursor: 'pointer' } : undefined }} connectNulls={false} isAnimationActive={false} />
              {series.comparison && <Line dataKey="compareValue" name="Comparison period" stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive={false} />}
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </ChartFrame>
  )
}

/** Ranked horizontal bars (count + share). Rows are real buttons only when `onSelect` is given. */
export function ReportBreakdownBars({
  rows,
  labelFor = titleCase,
  onSelect,
  emptyText = 'No records in this period.',
  limit = 8,
}: {
  rows: RankedRow[]
  labelFor?: (key: string) => string
  onSelect?: (key: string) => void
  emptyText?: string
  limit?: number
}) {
  const shown = rows.slice(0, limit)
  const max = Math.max(1, ...shown.map((r) => r.count))
  if (!shown.length) return <p className="py-4 text-center text-[13px] text-ink3">{emptyText}</p>
  return (
    <ul className="space-y-1.5" aria-label="Ranked breakdown">
      {shown.map((row) => {
        const body = (
          <>
            <span className="w-28 shrink-0 truncate text-left text-[12.5px] text-ink2 sm:w-36">{labelFor(row.key)}</span>
            <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(3, (row.count / max) * 100)}%` }} />
            </span>
            <span className="w-24 shrink-0 text-right text-[12.5px] tabular-nums text-ink">
              {row.count.toLocaleString('en-US')}
              <span className="ml-1 text-ink3">{row.share_pct !== null ? `${row.share_pct}%` : ''}</span>
            </span>
          </>
        )
        return (
          <li key={row.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(row.key)}
                aria-label={`${labelFor(row.key)}: ${row.count} records${row.share_pct !== null ? `, ${row.share_pct}% of total` : ''}. Open records`}
                className={cn('flex w-full items-center gap-3 rounded-[var(--r-md)] px-1.5 py-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40')}
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-1.5 py-1">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
