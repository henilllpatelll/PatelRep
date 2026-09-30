'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { Department, LogbookEntry, LogbookPaginationMeta } from '@/lib/api/logbook'
import type { Shift } from '@/lib/api/scheduling'
import type { StaffMember } from '@/lib/api/staff'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { categoryLabel, statusLabel, statusTone } from '@/lib/utils/logbookDisplay'
import { excerptForLogbookSearch, logbookMoreFilterCount, splitSearchHighlight, type LogbookSearchFilters } from '@/lib/utils/logbookSearch'

type DatePreset = 'any' | 'today' | 'yesterday' | 'last_7' | 'last_30' | 'month' | 'custom'

interface LogbookSearchWorkspaceProps {
  filters: LogbookSearchFilters
  today: string
  departments: Department[]
  shifts: Shift[]
  staff: StaffMember[]
  entries: LogbookEntry[]
  meta?: LogbookPaginationMeta
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  onRetry: () => void
  onFiltersChange: (filters: LogbookSearchFilters) => void
  onClearFilters: () => void
  onExit: () => void
  onOpen: (entry: LogbookEntry) => void
  onLoadMore: () => void
}

function dateOffset(today: string, days: number): string {
  const [year, month, day] = today.split('-').map(Number)
  const value = new Date(year, month - 1, day)
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function startOfMonth(today: string): string {
  return `${today.slice(0, 8)}01`
}

function datePreset(filters: LogbookSearchFilters, today: string): DatePreset {
  if (!filters.date_from && !filters.date_to) return 'any'
  if (filters.date_from === today && filters.date_to === today) return 'today'
  if (filters.date_from === dateOffset(today, -1) && filters.date_to === dateOffset(today, -1)) return 'yesterday'
  if (filters.date_from === dateOffset(today, -6) && filters.date_to === today) return 'last_7'
  if (filters.date_from === dateOffset(today, -29) && filters.date_to === today) return 'last_30'
  if (filters.date_from === startOfMonth(today) && filters.date_to === today) return 'month'
  return 'custom'
}

function HighlightedExcerpt({ content, query }: { content: string; query?: string }) {
  const excerpt = excerptForLogbookSearch(content, query)
  return <>{splitSearchHighlight(excerpt, query).map((part, index) => part.match ? <mark key={index} className="rounded bg-[var(--caution-soft)] px-0.5 text-inherit">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>
}

function ResultSkeleton() {
  return <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4"><Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-4 w-3/5" /><Skeleton className="mt-2 h-4 w-full" /><Skeleton className="mt-4 h-3 w-48" /></div>
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="flex min-w-[150px] items-center gap-2 text-xs font-medium text-ink3"><span>{label}</span><span className="relative flex-1"><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-9 w-full appearance-none rounded-[var(--r-md)] border border-line bg-surface py-2 pl-2.5 pr-8 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{children}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink3" aria-hidden="true" /></span></label>
}

export function LogbookSearchWorkspace({ filters, today, departments, shifts, staff, entries, meta, isLoading, isFetching, isError, onRetry, onFiltersChange, onClearFilters, onExit, onOpen, onLoadMore }: LogbookSearchWorkspaceProps) {
  const { t } = useTranslation()
  const [draftQuery, setDraftQuery] = useState(filters.q ?? '')
  const committedQueryRef = useRef(filters.q ?? '')
  const activeDatePreset = datePreset(filters, today)
  const moreCount = logbookMoreFilterCount(filters)
  const shiftNames = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift.name])), [shifts])
  const activeFilters = Boolean(filters.date_from || filters.date_to || filters.department_id || filters.category || filters.status || filters.priority || filters.shift_id || filters.author_id || filters.assigned_to || filters.related_type)

  function update(patch: Partial<LogbookSearchFilters>) {
    onFiltersChange({ ...filters, ...patch, page: undefined })
  }

  useEffect(() => {
    if ((filters.q ?? '') === draftQuery) return
    const timeout = window.setTimeout(() => update({ q: draftQuery.trim() || undefined }), 300)
    return () => window.clearTimeout(timeout)
  }, [draftQuery, filters.q]) // filters.q changes only after the debounced URL update.

  useEffect(() => {
    const committed = filters.q ?? ''
    if (committed !== committedQueryRef.current) setDraftQuery(committed)
    committedQueryRef.current = committed
  }, [filters.q])

  function setPreset(value: DatePreset) {
    if (value === 'custom') return
    if (value === 'any') return update({ date_from: undefined, date_to: undefined })
    if (value === 'today') return update({ date_from: today, date_to: today })
    if (value === 'yesterday') { const day = dateOffset(today, -1); return update({ date_from: day, date_to: day }) }
    if (value === 'last_7') return update({ date_from: dateOffset(today, -6), date_to: today })
    if (value === 'last_30') return update({ date_from: dateOffset(today, -29), date_to: today })
    return update({ date_from: startOfMonth(today), date_to: today })
  }

  return (
    <section aria-label={t('logbook.searchLogbook')} className="space-y-5">
      <div className="flex items-center gap-2 rounded-[var(--r-lg)] border border-line bg-surface px-3 py-2 shadow-[var(--shadow-xs)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
        <Search className="size-5 shrink-0 text-ink3" aria-hidden="true" />
        <label className="sr-only" htmlFor="logbook-search-input">{t('logbook.searchLogbook')}</label>
        <input id="logbook-search-input" autoFocus value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder={t('logbook.searchPlaceholder')} className="min-w-0 flex-1 bg-transparent py-1 text-base text-ink outline-none placeholder:text-ink4" />
        {isFetching && <span aria-live="polite" className="text-xs text-ink3">{t('logbook.loadingResults')}</span>}
        <button type="button" aria-label={t('logbook.resetSearch')} onClick={onExit} className="rounded p-1 text-ink3 hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X className="size-5" /></button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-[var(--r-lg)] border border-line bg-surface-2/50 p-3">
        <SelectField label={t('logbook.date')} value={activeDatePreset} onChange={(value) => setPreset(value as DatePreset)}>
          <option value="any">{t('logbook.anyTime')}</option><option value="today">{t('logbook.today')}</option><option value="yesterday">{t('logbook.yesterday')}</option><option value="last_7">{t('logbook.last7Days')}</option><option value="last_30">{t('logbook.last30Days')}</option><option value="month">{t('logbook.thisMonth')}</option><option value="custom">{t('logbook.customRange')}</option>
        </SelectField>
        <SelectField label={t('logbook.department')} value={filters.department_id ?? 'all'} onChange={(value) => update({ department_id: value === 'all' ? undefined : value })}><option value="all">{t('logbook.allDepartments')}</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</SelectField>
        <SelectField label={t('logbook.category')} value={filters.category ?? 'all'} onChange={(value) => update({ category: value === 'all' ? undefined : value as LogbookEntry['category'] })}><option value="all">{t('logbook.allCategories')}</option>{(['guest', 'room', 'maintenance', 'safety', 'general'] as const).map((category) => <option key={category} value={category}>{categoryLabel(t, category)}</option>)}</SelectField>
        <SelectField label={t('logbook.status')} value={filters.status ?? 'all'} onChange={(value) => update({ status: value === 'all' ? undefined : value as LogbookEntry['status'] })}><option value="all">{t('logbook.allStatuses')}</option>{(['informational', 'follow_up', 'resolved'] as const).map((status) => <option key={status} value={status}>{statusLabel(t, status)}</option>)}</SelectField>
        {activeDatePreset === 'custom' && <div className="flex items-end gap-2"><label className="text-xs font-medium text-ink3">{t('logbook.from')}<input type="date" max={filters.date_to || today} value={filters.date_from ?? ''} onChange={(event) => update({ date_from: event.target.value || undefined })} className="mt-1 block min-h-9 rounded border border-line bg-surface px-2 text-sm text-ink" /></label><label className="text-xs font-medium text-ink3">{t('logbook.to')}<input type="date" min={filters.date_from} max={today} value={filters.date_to ?? ''} onChange={(event) => update({ date_to: event.target.value || undefined })} className="mt-1 block min-h-9 rounded border border-line bg-surface px-2 text-sm text-ink" /></label></div>}
        <details className="relative"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2"><span>{t('logbook.moreFilters')}</span>{moreCount > 0 && <span className="rounded-full bg-[var(--accent-soft)] px-1.5 font-mono text-xs text-accent">{moreCount}</span>}<ChevronDown className="size-3.5" /></summary><div className="absolute right-0 z-20 mt-2 grid w-[min(94vw,700px)] grid-cols-1 gap-3 rounded-[var(--r-md)] border border-line bg-surface p-3 shadow-pop sm:grid-cols-2 lg:grid-cols-3"><SelectField label={t('logbook.shift')} value={filters.shift_id ?? 'all'} onChange={(value) => update({ shift_id: value === 'all' ? undefined : value })}><option value="all">{t('logbook.allShifts')}</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</SelectField><SelectField label={t('logbook.importance')} value={filters.priority ?? 'all'} onChange={(value) => update({ priority: value === 'all' ? undefined : 'important' })}><option value="all">{t('logbook.all')}</option><option value="important">{t('logbook.importantOnly')}</option></SelectField><SelectField label={t('logbook.author')} value={filters.author_id ?? 'all'} onChange={(value) => update({ author_id: value === 'all' ? undefined : value })}><option value="all">{t('logbook.anyone')}</option>{staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}</SelectField><SelectField label={t('logbook.followUpOwner')} value={filters.assigned_to ?? 'all'} onChange={(value) => update({ assigned_to: value === 'all' ? undefined : value })}><option value="all">{t('logbook.anyone')}</option><option value="__unassigned__">{t('logbook.unassigned')}</option>{staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}</SelectField><SelectField label={t('logbook.relatedTo')} value={filters.related_type ?? 'all'} onChange={(value) => update({ related_type: value === 'all' ? undefined : value as NonNullable<LogbookEntry['related_type']> })}><option value="all">{t('logbook.all')}</option>{(['room', 'task', 'work_order', 'guest_request'] as const).map((type) => <option key={type} value={type}>{t(`logbook.linkTypes.${type}`)}</option>)}</SelectField></div></details>
        {activeFilters && <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-ink3">{t('logbook.clearFilters')}</Button>}
      </div>

      {isLoading ? <div className="space-y-3"><ResultSkeleton /><ResultSkeleton /><ResultSkeleton /></div> : isError ? <div className="rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-5"><p className="font-medium text-ink">{t('logbook.searchError')}</p><Button variant="outline" size="sm" onClick={onRetry} className="mt-3">{t('common.retry')}</Button></div> : <><header><h2 className="text-base font-semibold text-ink">{filters.q ? t('logbook.resultsFor', { count: meta?.total ?? 0, query: filters.q }) : t('logbook.results', { count: meta?.total ?? 0 })}</h2></header>{entries.length === 0 ? <div className="rounded-[var(--r-lg)] border border-dashed border-line bg-surface p-8 text-center"><p className="font-medium text-ink">{filters.q ? t('logbook.noSearchResults', { query: filters.q }) : t('logbook.noFilteredResults')}</p><p className="mt-2 text-sm text-ink3">{filters.q ? t('logbook.searchSuggestions') : t('logbook.clearFiltersHint')}</p>{activeFilters && <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-4">{t('logbook.clearFilters')}</Button>}</div> : <div className="space-y-2">{entries.map((entry) => { const author = entry.user_profiles?.preferred_name || entry.user_profiles?.full_name || t('logbook.teamMember'); return <button key={entry.id} type="button" onClick={() => onOpen(entry)} className="block w-full rounded-[var(--r-lg)] border border-line bg-surface p-4 text-left transition hover:shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[11px] font-medium uppercase tracking-[.08em] text-ink3">{format(new Date(entry.created_at), 'MMM d · h:mm a')}</p><div className="flex flex-wrap gap-1.5"><Pill tone="neutral" size="sm">{categoryLabel(t, entry.category)}</Pill>{entry.priority === 'important' && <Pill tone="alert" size="sm">{t('logbook.priorities.important')}</Pill>}{entry.status !== 'informational' && <Pill tone={statusTone(entry.status)} size="sm">{statusLabel(t, entry.status)}</Pill>}</div></div><p className="mt-3 line-clamp-2 text-sm leading-6 text-ink"><HighlightedExcerpt content={entry.content} query={filters.q} /></p><p className="mt-3 text-xs text-ink3">{entry.departments?.name || t('logbook.general')} · {author} · {entry.shift_id ? shiftNames.get(entry.shift_id) ?? t('logbook.shift') : t('logbook.legacyEntry')}{entry.carried_from_entry_id ? ` · ${t('logbook.carriedForward')}` : ''}{entry.resolved_at ? ` · ${t('logbook.resolvedAt', { date: format(new Date(entry.resolved_at), 'MMM d') })}` : ''}</p></button> })}</div>}{meta?.has_more && <div className="pt-3 text-center"><Button variant="outline" size="sm" onClick={onLoadMore} loading={isFetching}>{t('logbook.loadMoreResults')}</Button></div>}</>}
    </section>
  )
}
