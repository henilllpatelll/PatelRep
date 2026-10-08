/**
 * Pure helpers for Settings > Activity & Audit. Everything shown is derived from the recorded event the API
 * returned; missing information stays missing (never guessed or back-filled from current data).
 */
import type { ActivityChange, ActivityEvent, ActivityQuery } from '@/lib/api/activity'

export const DEFAULT_RANGE_DAYS = 30
export const MAX_EXPORT_DAYS = 92

export interface ActivityFilters {
  q: string
  category: string
  actor_id: string
  resource_type: string
  date_from: string
  date_to: string
}

export const EMPTY_FILTERS: ActivityFilters = { q: '', category: '', actor_id: '', resource_type: '', date_from: '', date_to: '' }

const PARAM_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ActivityFilters)[]
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Read filters from URL search params, ignoring anything malformed (the server validates again). */
export function parseFilters(params: { get(name: string): string | null }): ActivityFilters {
  const read = (key: keyof ActivityFilters) => (params.get(key) ?? '').trim().slice(0, 100)
  const filters = { ...EMPTY_FILTERS }
  for (const key of PARAM_KEYS) filters[key] = read(key)
  if (!DATE_ONLY.test(filters.date_from)) filters.date_from = ''
  if (!DATE_ONLY.test(filters.date_to)) filters.date_to = ''
  return filters
}

/** Only non-empty filters go into the URL / request. */
export function filtersToQuery(filters: ActivityFilters): ActivityQuery {
  const query: ActivityQuery = {}
  for (const key of PARAM_KEYS) if (filters[key]) query[key] = filters[key]
  return query
}

export function filtersToSearch(filters: ActivityFilters): string {
  const search = new URLSearchParams(filtersToQuery(filters) as Record<string, string>)
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Filters shown in the "Filters" count (search text has its own box). */
export function countActiveFilters(filters: ActivityFilters): number {
  return (['category', 'actor_id', 'resource_type'] as const).filter((k) => filters[k]).length
    + (filters.date_from || filters.date_to ? 1 : 0)
}

export function hasAnyFilter(filters: ActivityFilters): boolean {
  return Boolean(filters.q) || countActiveFilters(filters) > 0
}

// ─── Time ─────────────────────────────────────────────────────────────────────

export function safeZone(zone: string | null | undefined): string {
  try {
    if (zone) { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone }
  } catch { /* fall through */ }
  return 'UTC'
}

/** Calendar day (YYYY-MM-DD) of an instant in the given zone. */
export function dayKey(iso: string | number | Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(zone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return parts // en-CA formats as YYYY-MM-DD
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
}

export interface EventGroup { key: string; label: string; events: ActivityEvent[] }

/** Group (already newest-first) events by hotel-local day, labelled Today / Yesterday / weekday date. */
export function groupEventsByDay(events: ActivityEvent[], zone: string, now: number = Date.now()): EventGroup[] {
  const today = dayKey(now, zone)
  const groups: EventGroup[] = []
  for (const event of events) {
    const key = dayKey(event.occurred_at, zone)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(event)
    else groups.push({ key, label: dayLabel(key, today), events: [event] })
  }
  return groups
}

export function formatTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: safeZone(zone) }).format(new Date(iso))
}

/** "October 8, 2026 · 2:41 PM CDT" in the hotel's time zone. */
export function formatFullTimestamp(iso: string, zone: string): string {
  const tz = safeZone(zone)
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: tz }).format(new Date(iso))
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: tz }).format(new Date(iso))
  return `${date} · ${time}`
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/** Date range an export would cover for these filters (defaults match the server: last 30 days). */
export function exportRange(filters: ActivityFilters, zone: string, now: number = Date.now()): { from: string; to: string; days: number } {
  const to = filters.date_to || dayKey(now, zone)
  const from = filters.date_from || addDays(to, -(DEFAULT_RANGE_DAYS - 1))
  return { from, to, days: daysBetween(from, to) }
}

export function presetRange(days: number, zone: string, now: number = Date.now()): { date_from: string; date_to: string } {
  const to = dayKey(now, zone)
  return { date_from: addDays(to, -(days - 1)), date_to: to }
}

// ─── Display ──────────────────────────────────────────────────────────────────

export function sourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case 'web': return 'Web app'
    case 'mobile': return 'Mobile app'
    case 'api': return 'PatelRep API'
    case 'automation': return 'Automated process'
    default: return source ? source : null
  }
}

export function humanizeKey(key: string): string {
  const text = key.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((v) => humanizeKey(String(v))).join(', ') : 'None'
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length ? entries.map(([k, v]) => `${humanizeKey(k)}: ${formatValue(v)}`).join('; ') : 'None'
  }
  return String(value)
}

export type ChangeView =
  | { kind: 'list'; label: string; before?: string[]; after?: string[]; added: string[]; removed: string[] }
  | { kind: 'map'; label: string; rows: { key: string; before: string | null; after: string | null }[] }
  | { kind: 'value'; label: string; before: string | null; after: string | null }

const toStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map((v) => humanizeKey(String(v))) : undefined

/**
 * Presentation model for one recorded change. `null` means "not recorded" (the field was absent from the
 * stored state), which the UI must show as such — different from a recorded empty value ("Not set").
 */
export function describeChange(change: ActivityChange): ChangeView {
  const hasBefore = 'before' in change
  const hasAfter = 'after' in change
  if (change.added || change.removed) {
    return {
      kind: 'list', label: change.label,
      before: hasBefore ? toStrings(change.before) ?? [] : undefined,
      after: hasAfter ? toStrings(change.after) ?? [] : undefined,
      added: (change.added ?? []).map((v) => humanizeKey(String(v))),
      removed: (change.removed ?? []).map((v) => humanizeKey(String(v))),
    }
  }
  if (change.changed_keys) {
    const before = (hasBefore && typeof change.before === 'object' && change.before ? change.before : {}) as Record<string, unknown>
    const after = (hasAfter && typeof change.after === 'object' && change.after ? change.after : {}) as Record<string, unknown>
    return {
      kind: 'map', label: change.label,
      rows: change.changed_keys.map((key) => ({
        key: humanizeKey(key),
        before: hasBefore ? formatValue(before[key]) : null,
        after: hasAfter ? formatValue(after[key]) : null,
      })),
    }
  }
  return {
    kind: 'value', label: change.label,
    before: hasBefore ? formatValue(change.before) : null,
    after: hasAfter ? formatValue(change.after) : null,
  }
}
