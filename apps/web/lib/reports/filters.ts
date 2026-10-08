// Global Reports filters: presets, hotel-local dates, URL (de)serialisation + validation.
// Pure functions only — everything here is unit-tested without a DOM.

export const REPORT_VIEWS = [
  'overview',
  'guest-experience',
  'housekeeping',
  'maintenance',
  'team',
  'management',
] as const
export type ReportView = (typeof REPORT_VIEWS)[number]

export const VIEW_LABELS: Record<ReportView, string> = {
  overview: 'Overview',
  'guest-experience': 'Guest Experience',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  team: 'Team',
  management: 'Management',
}

export const RANGE_PRESETS = ['today', 'last_7_days', 'last_30_days', 'last_90_days', 'year_to_date', 'custom'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  year_to_date: 'Year to date',
  custom: 'Custom range',
}

export const COMPARISON_MODES = ['previous', 'last_year', 'none'] as const
export type ComparisonMode = (typeof COMPARISON_MODES)[number]
export const COMPARISON_LABELS: Record<ComparisonMode, string> = {
  previous: 'Previous equivalent period',
  last_year: 'Same period last year',
  none: 'No comparison',
}

export const DEPARTMENTS = ['housekeeping', 'engineering'] as const
export type DepartmentFilter = '' | (typeof DEPARTMENTS)[number]
export const DEPARTMENT_LABELS: Record<string, string> = { housekeeping: 'Housekeeping', engineering: 'Engineering' }

export const MAX_RANGE_DAYS = 366
export const DEFAULT_PRESET = 'last_30_days' as const
export const DEFAULT_COMPARISON: ComparisonMode = 'previous'

export interface ReportFilters {
  preset: RangePreset
  start: string // YYYY-MM-DD, hotel-local
  end: string // YYYY-MM-DD, hotel-local, inclusive
  compare: ComparisonMode
  department: DepartmentFilter
}

interface ParamsLike {
  get(name: string): string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Hotel-local calendar date (YYYY-MM-DD) for `now` in an IANA timezone. */
export function hotelToday(timezone: string | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    if (isValidIsoDate(parts)) return parts
  } catch {
    // fall through to UTC
  }
  return now.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
}

export function resolvePreset(preset: Exclude<RangePreset, 'custom'>, today: string): { start: string; end: string } {
  switch (preset) {
    case 'today':
      return { start: today, end: today }
    case 'last_7_days':
      return { start: addDays(today, -6), end: today }
    case 'last_30_days':
      return { start: addDays(today, -29), end: today }
    case 'last_90_days':
      return { start: addDays(today, -89), end: today }
    case 'year_to_date':
      return { start: `${today.slice(0, 4)}-01-01`, end: today }
  }
}

export function defaultFilters(today: string): ReportFilters {
  return { preset: DEFAULT_PRESET, ...resolvePreset(DEFAULT_PRESET, today), compare: DEFAULT_COMPARISON, department: '' }
}

export function isValidCustomRange(start: string, end: string, today: string): boolean {
  return isValidIsoDate(start) && isValidIsoDate(end) && start <= end && end <= today && daysBetweenInclusive(start, end) <= MAX_RANGE_DAYS
}

/** Parse + validate URL params; anything invalid silently falls back to a safe default. */
export function filtersFromParams(params: ParamsLike, today: string, allowedDepartments?: readonly string[]): ReportFilters {
  const base = defaultFilters(today)
  const rangeParam = params.get('range')
  const preset = (RANGE_PRESETS as readonly string[]).includes(rangeParam ?? '') ? (rangeParam as RangePreset) : DEFAULT_PRESET

  let range = { start: base.start, end: base.end }
  let resolvedPreset: RangePreset = preset
  if (preset === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (from && to && isValidCustomRange(from, to, today)) range = { start: from, end: to }
    else resolvedPreset = DEFAULT_PRESET
  } else {
    range = resolvePreset(preset, today)
  }

  const cmp = params.get('cmp')
  const compare = (COMPARISON_MODES as readonly string[]).includes(cmp ?? '') ? (cmp as ComparisonMode) : DEFAULT_COMPARISON

  const dept = params.get('dept') ?? ''
  const departmentAllowed = (DEPARTMENTS as readonly string[]).includes(dept) && (!allowedDepartments || allowedDepartments.includes(dept))
  return { preset: resolvedPreset, ...range, compare, department: departmentAllowed ? (dept as DepartmentFilter) : '' }
}

/** Write filters into a (copy of a) URLSearchParams; defaults are omitted to keep URLs short. */
export function filtersToParams(filters: ReportFilters, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? '')
  for (const key of ['range', 'from', 'to', 'cmp', 'dept']) params.delete(key)
  if (filters.preset !== DEFAULT_PRESET) params.set('range', filters.preset)
  if (filters.preset === 'custom') {
    params.set('from', filters.start)
    params.set('to', filters.end)
  }
  if (filters.compare !== DEFAULT_COMPARISON) params.set('cmp', filters.compare)
  if (filters.department) params.set('dept', filters.department)
  return params
}

export function parseView(value: string | null, allowed: readonly string[]): ReportView | null {
  if (value && (REPORT_VIEWS as readonly string[]).includes(value) && allowed.includes(value)) return value as ReportView
  return null
}

export function describeRange(filters: Pick<ReportFilters, 'preset' | 'start' | 'end'>): string {
  return filters.preset === 'today' || filters.start === filters.end ? filters.start : `${filters.start} to ${filters.end}`
}

/** Query params understood by every report endpoint. */
export function filterQuery(filters: ReportFilters, includeDepartment = true) {
  return {
    start_date: filters.start,
    end_date: filters.end,
    compare: filters.compare === 'none' ? undefined : filters.compare,
    department: includeDepartment && filters.department ? filters.department : undefined,
  }
}
