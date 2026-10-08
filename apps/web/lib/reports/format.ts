// Display formatting for report values. Missing data is NEVER rendered as 0.

export type Availability = 'available' | 'not_applicable' | 'not_configured' | 'not_enough_data' | 'unavailable'

export const AVAILABILITY_TEXT: Record<Exclude<Availability, 'available'>, string> = {
  not_applicable: 'Not applicable',
  not_configured: 'Not configured',
  not_enough_data: 'Not enough data',
  unavailable: 'Unavailable',
}

export function formatValue(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '—'
  switch (unit) {
    case 'percent':
      return `${trim(value)}%`
    case 'minutes':
      return value >= 90 ? `${trim(value / 60)} h` : `${trim(value)} min`
    case 'hours':
      // Sub-hour values read better in minutes ("0 h" would hide a real, non-zero duration).
      return value > 0 && value < 1 ? `${Math.max(1, Math.round(value * 60))} min` : `${trim(value)} h`
    case 'currency':
      return `$${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    default:
      return trim(value)
  }
}

function trim(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export interface Comparison {
  previous: number
  change: number
  change_kind: 'percentage_points' | 'percent'
  direction: 'favorable' | 'unfavorable' | 'neutral'
}

export function formatChange(comparison: Pick<Comparison, 'change' | 'change_kind'>): string {
  const sign = comparison.change > 0 ? '+' : comparison.change < 0 ? '−' : ''
  const magnitude = trim(Math.abs(comparison.change))
  return comparison.change_kind === 'percentage_points' ? `${sign}${magnitude} percentage points` : `${sign}${magnitude}%`
}

export const DIRECTION_TEXT = { favorable: 'Favorable', unfavorable: 'Unfavorable', neutral: 'Not rated better or worse' } as const

/** Direction wording. 'neutral' means either no change or a metric with no better/worse polarity (e.g. a count). */
export function directionText(comparison: Pick<Comparison, 'change' | 'direction'>): string {
  if (comparison.direction === 'neutral') return comparison.change === 0 ? 'No change' : DIRECTION_TEXT.neutral
  return DIRECTION_TEXT[comparison.direction]
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatDateTime(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
  } catch {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Client-side comparison for already-aggregated totals (same rules as the API): rates -> percentage points, others -> relative %. */
export function compareTotals(current: number | null, previous: number | null, unit: string | null | undefined): Comparison | null {
  if (current === null || previous === null) return null
  if (unit === 'percent') {
    const change = Math.round((current - previous) * 10) / 10
    return { previous, change, change_kind: 'percentage_points', direction: 'neutral' }
  }
  if (previous === 0) return null
  const change = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
  return { previous, change, change_kind: 'percent', direction: 'neutral' }
}
