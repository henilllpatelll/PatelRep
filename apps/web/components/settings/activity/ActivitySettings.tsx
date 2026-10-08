'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download, Filter, History, Search, X } from 'lucide-react'
import { activityApi, type ActivityEvent } from '@/lib/api/activity'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useRole } from '@/lib/hooks/useRole'
import { useHotelStore } from '@/stores/hotelStore'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  EMPTY_FILTERS, MAX_EXPORT_DAYS, countActiveFilters, exportRange, filtersToQuery, filtersToSearch, formatTime,
  groupEventsByDay, hasAnyFilter, parseFilters, safeZone, type ActivityFilters,
} from '@/lib/settings/activity'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsTextInput } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { ACTIVITY_CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from './activityIcons'
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer'
import { ActivityFiltersDrawer } from './ActivityFiltersDrawer'

const SEARCH_DEBOUNCE_MS = 300

export function ActivitySettings() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const toast = useToast()
  const { isGM, role } = useRole()
  const hotel = useHotelStore((s) => s.hotel)
  const hotelId = hotel?.id

  const filters = useMemo(() => parseFilters(params), [params])
  const [searchText, setSearchText] = useState(filters.q)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const filtersButton = useRef<HTMLButtonElement>(null)

  const replace = (next: ActivityFilters) => router.replace(`${pathname}${filtersToSearch(next)}`, { scroll: false })

  // Keep the box in step with the URL (Clear, back/forward), and push typing to the URL after a pause.
  useEffect(() => { setSearchText(filters.q) }, [filters.q])
  useEffect(() => {
    if (searchText.trim() === filters.q) return
    const timer = setTimeout(() => replace({ ...filters, q: searchText.trim().slice(0, 100) }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, filters])

  const query = filtersToQuery(filters)
  const list = useInfiniteQuery({
    queryKey: ['settings-activity', hotelId, query],
    queryFn: ({ pageParam }) => activityApi.list(query, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor,
    enabled: !!hotelId && isGM,
    staleTime: 30_000,
    retry: 1,
  })
  const options = useQuery({ queryKey: ['settings-activity-options'], queryFn: () => activityApi.categories(), staleTime: Infinity, enabled: !!hotelId && isGM })
  const actors = useQuery({
    queryKey: ['settings-activity-actors', hotelId], queryFn: () => activityApi.actors(), staleTime: 60_000,
    enabled: !!hotelId && isGM && Boolean(filters.actor_id),
  })

  const zone = safeZone(list.data?.pages[0]?.meta.timezone ?? hotel?.timezone)
  const events = useMemo(() => {
    const seen = new Set<string>()
    return (list.data?.pages ?? []).flatMap((p) => p.data).filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  }, [list.data])
  const groups = useMemo(() => groupEventsByDay(events, zone), [events, zone])

  if (!role) return <SettingsLoading />
  if (!isGM) return <p role="alert" className="text-sm text-ink-3">Activity & Audit is only available to hotel GMs.</p>

  const activeCount = countActiveFilters(filters)
  const chips = [
    filters.category && { key: 'category', label: `Category: ${options.data?.data.find((c) => c.id === filters.category)?.label ?? filters.category}`, clear: { category: '' } },
    filters.actor_id && { key: 'actor_id', label: `Actor: ${actors.data?.data.find((a) => a.id === filters.actor_id)?.name ?? 'Selected person'}`, clear: { actor_id: '' } },
    filters.resource_type && { key: 'resource_type', label: `Resource: ${options.data?.meta.resource_types.find((r) => r.id === filters.resource_type)?.label ?? filters.resource_type}`, clear: { resource_type: '' } },
    (filters.date_from || filters.date_to) && {
      key: 'dates', label: `Dates: ${filters.date_from || '…'} to ${filters.date_to || 'today'}`, clear: { date_from: '', date_to: '' },
    },
  ].filter(Boolean) as { key: string; label: string; clear: Partial<ActivityFilters> }[]

  const clearAll = () => { setSearchText(''); replace(EMPTY_FILTERS) }

  const exportCsv = async () => {
    setExportNote(null)
    const range = exportRange(filters, zone)
    if (range.days > MAX_EXPORT_DAYS) {
      setExportNote(`Exports cover at most ${MAX_EXPORT_DAYS} days. Narrow the date range and try again.`)
      return
    }
    setExporting(true)
    try {
      const blob = await activityApi.exportCsv(query)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `activity-${range.from}-to-${range.to}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Activity exported.')
    } catch (err) {
      setExportNote(errorMessage(err, 'The export couldn’t be created. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        level={1}
        title="Activity & Audit"
        description="Review important property and configuration changes."
        actions={<Button variant="outline" onClick={exportCsv} loading={exporting}><Download size={14} aria-hidden="true" /> Export Activity</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <SettingsTextInput
            type="search"
            aria-label="Search activity"
            placeholder="Search activity..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            maxLength={100}
            className="pl-9"
          />
        </div>
        <Button ref={filtersButton} variant="outline" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
          <Filter size={14} aria-hidden="true" /> Filters{activeCount > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" aria-label={`${activeCount} active`}>{activeCount}</span>}
        </Button>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs text-ink-2">
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => replace({ ...filters, ...chip.clear })}
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              ><X size={12} aria-hidden="true" /></button>
            </li>
          ))}
          <li><button type="button" onClick={() => replace({ ...EMPTY_FILTERS, q: filters.q })} className="text-xs font-medium text-[var(--accent)] hover:underline">Clear Filters</button></li>
        </ul>
      )}
      {exportNote && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{exportNote}</p>}

      {list.isPending ? (
        <SettingsLoading label="Loading activity…" />
      ) : list.isError ? (
        <SettingsError message="Activity could not be loaded." onRetry={() => list.refetch()} />
      ) : events.length === 0 ? (
        hasAnyFilter(filters) ? (
          <SettingsEmpty
            icon={<History size={20} />}
            title="No activity matches these filters."
            action={<Button variant="outline" onClick={clearAll}>Clear Filters</Button>}
          />
        ) : (
          <SettingsEmpty
            icon={<History size={20} />}
            title="No activity has been recorded for this property yet."
            body="This screen lists recorded events from the last 30 days. It does not reconstruct changes that were made before they were logged."
          />
        )
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`activity-day-${group.key}`} className="space-y-2">
              <h2 id={`activity-day-${group.key}`} className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{group.label}</h2>
              <SettingsCard as="div" className="p-0">
                <ul className="divide-y divide-line">
                  {group.events.map((event) => <ActivityRow key={event.id} event={event} zone={zone} onOpen={() => setSelectedId(event.id)} />)}
                </ul>
              </SettingsCard>
            </section>
          ))}
          <div className="flex flex-col items-center gap-2">
            {list.hasNextPage ? (
              <Button variant="outline" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button>
            ) : (
              <p className="text-xs text-ink-3">That’s everything recorded for this date range.</p>
            )}
            {list.isFetchNextPageError && <p role="alert" className="text-[13px] text-[var(--alert)]">More activity couldn’t be loaded. Try again.</p>}
          </div>
        </div>
      )}

      {filtersOpen && (
        <ActivityFiltersDrawer
          filters={filters}
          hotelId={hotelId}
          zone={zone}
          onApply={(next) => { replace(next); setFiltersOpen(false) }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {selectedId && <ActivityDetailsDrawer eventId={selectedId} hotelId={hotelId} zone={zone} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function ActivityRow({ event, zone, onOpen }: { event: ActivityEvent; zone: string; onOpen: () => void }) {
  const Icon = ACTIVITY_CATEGORY_ICONS[event.category ?? ''] ?? DEFAULT_CATEGORY_ICON
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2" aria-hidden="true"><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{event.title}</p>
        <p className="truncate text-[13px] text-ink-3">
          {event.actor.name} · <time dateTime={event.occurred_at}>{formatTime(event.occurred_at, zone)}</time>
          {event.category_label ? ` · ${event.category_label}` : ''}
          {event.resource.name ? ` · ${event.resource.name}` : ''}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onOpen} aria-label={`View details: ${event.title}, ${event.actor.name}, ${formatTime(event.occurred_at, zone)}`}>
        View Details
      </Button>
    </li>
  )
}
