import type { LogbookCategory, LogbookPriority, LogbookRelatedType, LogbookStatus } from '@/lib/api/logbook'

const CATEGORIES: readonly LogbookCategory[] = ['guest', 'room', 'maintenance', 'safety', 'general']
const STATUSES: readonly LogbookStatus[] = ['informational', 'follow_up', 'resolved']
const PRIORITIES: readonly LogbookPriority[] = ['normal', 'important']
const RELATED_TYPES: readonly LogbookRelatedType[] = ['room', 'task', 'work_order', 'guest_request']
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface LogbookSearchFilters {
  q?: string
  date_from?: string
  date_to?: string
  department_id?: string
  shift_id?: string
  category?: LogbookCategory
  status?: LogbookStatus
  priority?: LogbookPriority
  author_id?: string
  assigned_to?: string
  related_type?: LogbookRelatedType
  page?: number
}

function oneOf<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return value && values.includes(value as T) ? value as T : undefined
}

function validDate(value: string | null): string | undefined {
  if (!value || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) return undefined
  return value
}

function validId(value: string | null, allowUnassigned = false): string | undefined {
  if (allowUnassigned && value === '__unassigned__') return value
  return value && UUID_PATTERN.test(value) ? value : undefined
}

/** Parses only supported URL state. Invalid values intentionally become defaults. */
export function parseLogbookSearchParams(params: URLSearchParams): LogbookSearchFilters {
  const dateFrom = validDate(params.get('date_from'))
  const dateTo = validDate(params.get('date_to'))
  const dateRangeIsValid = !(dateFrom && dateTo && dateFrom > dateTo)
  const page = Number(params.get('page'))
  const q = params.get('q')?.trim().slice(0, 160)

  return {
    q: q || undefined,
    date_from: dateRangeIsValid ? dateFrom : undefined,
    date_to: dateRangeIsValid ? dateTo : undefined,
    department_id: validId(params.get('department')),
    shift_id: validId(params.get('shift')),
    category: oneOf(params.get('category'), CATEGORIES),
    status: oneOf(params.get('status'), STATUSES),
    priority: oneOf(params.get('priority'), PRIORITIES),
    author_id: validId(params.get('author')),
    assigned_to: validId(params.get('assigned_to'), true),
    related_type: oneOf(params.get('related_type'), RELATED_TYPES),
    page: Number.isInteger(page) && page > 1 && page <= 10000 ? page : undefined,
  }
}

export function logbookSearchParams(filters: LogbookSearchFilters): URLSearchParams {
  const params = new URLSearchParams()
  const mappings: Array<[keyof LogbookSearchFilters, string]> = [
    ['q', 'q'], ['date_from', 'date_from'], ['date_to', 'date_to'], ['department_id', 'department'],
    ['shift_id', 'shift'], ['category', 'category'], ['status', 'status'], ['priority', 'priority'],
    ['author_id', 'author'], ['assigned_to', 'assigned_to'], ['related_type', 'related_type'], ['page', 'page'],
  ]
  mappings.forEach(([key, param]) => {
    const value = filters[key]
    if (value !== undefined && value !== '') params.set(param, String(value))
  })
  return params
}

export function hasLogbookSearchState(filters: LogbookSearchFilters): boolean {
  return Boolean(filters.q || filters.date_from || filters.date_to || filters.category || filters.status || filters.priority || filters.author_id || filters.assigned_to || filters.related_type || filters.shift_id)
}

export function logbookMoreFilterCount(filters: LogbookSearchFilters): number {
  return [filters.shift_id, filters.priority, filters.author_id, filters.assigned_to, filters.related_type].filter(Boolean).length
}

export function splitSearchHighlight(content: string, query?: string): Array<{ text: string; match?: true }> {
  const needle = query?.trim()
  if (!needle) return [{ text: content }]
  const match = content.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (match < 0) return [{ text: content }]
  return [
    ...(match ? [{ text: content.slice(0, match) }] : []),
    { text: content.slice(match, match + needle.length), match: true as const },
    ...(match + needle.length < content.length ? [{ text: content.slice(match + needle.length) }] : []),
  ]
}

export function excerptForLogbookSearch(content: string, query?: string, limit = 220): string {
  if (content.length <= limit) return content
  const index = query ? content.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) : -1
  const start = index > 0 ? Math.max(0, index - Math.floor(limit / 3)) : 0
  const end = Math.min(content.length, start + limit)
  return `${start ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`
}
