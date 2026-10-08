'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { reportsV2Api } from '@/lib/reports/api'
import type { DrawerState, RecordKind } from '@/lib/reports/drawerState'
import { describeRange } from '@/lib/reports/filters'
import { formatDateTime, titleCase } from '@/lib/reports/format'
import { recordHref } from '@/lib/reports/links'
import { ReportDrawer, drawerButton } from './ReportDrawer'
import { EmptyBlock, ErrorBlock, LiveBadge, ReportPill, SectionSkeleton } from './ReportPrimitives'
import { useReports } from './ReportsContext'

type RecordsState = Extract<DrawerState, { kind: 'filtered-records' }>

const KIND_TITLES: Record<RecordKind, string> = {
  work_orders: 'Work orders',
  guest_requests: 'Guest requests',
  inspections: 'Inspections',
  pm_deferrals: 'Preventive maintenance deferrals',
  tasks: 'Tasks',
}
const STATUS_OPTIONS: Partial<Record<RecordKind, string[]>> = {
  work_orders: ['open', 'in_progress', 'on_hold', 'completed', 'cancelled'],
  guest_requests: ['open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'resolved', 'verified', 'reopened', 'cancelled'],
}
const SLA_TONE: Record<string, 'ready' | 'alert' | 'neutral' | 'caution'> = { met: 'ready', missed: 'alert', open_overdue: 'alert', not_eligible: 'neutral', open: 'neutral' }
const SLA_TEXT: Record<string, string> = { met: 'Met SLA', missed: 'Missed SLA', open_overdue: 'Overdue', not_eligible: 'No SLA deadline', open: 'In progress' }

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function RecordLink({ kind, row, children }: { kind: RecordKind; row: Record<string, any>; children: React.ReactNode }) {
  const { role } = useReports()
  const href = recordHref(kind, row, role)
  return href ? (
    <Link href={href} className="font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
      {children}
    </Link>
  ) : (
    <span className="font-medium text-ink">{children}</span>
  )
}

function RecordRow({ kind, row }: { kind: RecordKind; row: Record<string, any> }) {
  const { openDrawer } = useReports()
  const roomButton =
    row.room_id && row.room ? (
      <button type="button" className="text-ink3 underline-offset-2 hover:underline" onClick={() => openDrawer({ kind: 'room-asset-performance', entity: 'room', id: row.room_id })}>
        Room {row.room}
      </button>
    ) : row.room ? (
      <span>Room {row.room}</span>
    ) : null

  switch (kind) {
    case 'work_orders':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <RecordLink kind={kind} row={row}>{row.title ?? 'Work order'}</RecordLink>
            <ReportPill tone={SLA_TONE[row.sla_state] ?? 'neutral'} size="sm">{SLA_TEXT[row.sla_state] ?? titleCase(row.sla_state)}</ReportPill>
          </div>
          <p className="text-[12.5px] text-ink3">
            {[roomButton, titleCase(row.category), titleCase(row.priority), titleCase(row.status), row.assigned_to ? `Assigned: ${row.assigned_to}` : 'Unassigned'].filter(Boolean).map((part, i) => <span key={i}>{i ? ' · ' : ''}{part}</span>)}
          </p>
          <p className="text-[12px] text-ink3">Created {formatDateTime(row.created_at)} · Due {formatDateTime(row.due_at)}{row.completed_at ? ` · Done ${formatDateTime(row.completed_at)}` : ''}</p>
          {row.asset_id && (
            <button type="button" className="text-[12px] text-ink3 underline-offset-2 hover:underline" onClick={() => openDrawer({ kind: 'room-asset-performance', entity: 'asset', id: row.asset_id })}>Asset history</button>
          )}
        </div>
      )
    case 'guest_requests':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <RecordLink kind={kind} row={row}>{row.request_number ? `#${row.request_number} ` : ''}{row.summary ?? 'Request'}</RecordLink>
            <ReportPill tone={row.sla_state === 'met' ? 'ready' : row.sla_state === 'missed' ? 'alert' : 'neutral'} size="sm">{row.sla_state === 'not_eligible' ? 'No SLA deadline' : titleCase(row.sla_state)}</ReportPill>
          </div>
          <p className="text-[12.5px] text-ink3">{[roomButton, titleCase(row.category), titleCase(row.status), row.department ? titleCase(row.department) : 'Unattributed'].filter(Boolean).map((part, i) => <span key={i}>{i ? ' · ' : ''}{part}</span>)}</p>
          <p className="text-[12px] text-ink3">Created {formatDateTime(row.created_at)} · Due {formatDateTime(row.due_at)}</p>
        </div>
      )
    case 'inspections':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{roomButton ?? 'Room'}</span>
            <ReportPill tone={row.result === 'passed' ? 'ready' : row.result === 'failed' ? 'alert' : 'caution'} size="sm">{titleCase(row.result)}</ReportPill>
          </div>
          <p className="text-[12px] text-ink3">Completed {formatDateTime(row.completed_at)}</p>
        </div>
      )
    case 'pm_deferrals':
      return (
        <div className="space-y-1">
          <RecordLink kind={kind} row={row}>{row.name ?? 'Schedule'}</RecordLink>
          <p className="text-[12.5px] text-ink3">Deferred {row.deferral_count}× in period · until {formatDateTime(row.deferred_until)}</p>
          <p className="text-[12px] text-ink3">{row.reason ?? ''}</p>
        </div>
      )
    case 'tasks':
      return (
        <div className="space-y-1">
          <RecordLink kind={kind} row={row}>{row.title ?? 'Task'}</RecordLink>
          <p className="text-[12.5px] text-ink3">{[titleCase(row.status), titleCase(row.priority), row.assigned_to].filter(Boolean).join(' · ')}</p>
          <p className="text-[12px] text-ink3">Due {formatDateTime(row.due_at)}{row.completed_at ? ` · Done ${formatDateTime(row.completed_at)}` : ''}</p>
        </div>
      )
  }
}

export function FilteredRecordsDrawer({ state }: { state: RecordsState }) {
  const { filters, queryScope, ready } = useReports()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const debounced = useDebounced(search)
  const key = JSON.stringify([state.recordKind, state.filter, state.extra])

  // New record group -> back to page 1 with clean local filters.
  useEffect(() => {
    setPage(1)
    setSearch('')
    setStatus('')
    setPriority('')
  }, [key])
  useEffect(() => setPage(1), [debounced, status, priority])

  const supportsSearch = state.recordKind === 'work_orders' || state.recordKind === 'guest_requests'
  const params = {
    kind: state.recordKind,
    filter: state.filter,
    page,
    per_page: 20,
    search: debounced || undefined,
    ...state.extra,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  } as Parameters<typeof reportsV2Api.records>[0]

  const query = useQuery({
    queryKey: [...queryScope, 'records', params, filters],
    queryFn: () => reportsV2Api.records(params, filters),
    enabled: ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const totalPages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.per_page)) : 1
  const activeChips = Object.entries(state.extra).filter(([, v]) => v)

  return (
    <ReportDrawer
      title={state.title ?? KIND_TITLES[state.recordKind]}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{data?.scope === 'live' ? 'Live right now' : describeRange(filters)}</span>
          {data && <span>· {data.meta.total} record{data.meta.total === 1 ? '' : 's'}</span>}
          {data?.scope === 'live' && <LiveBadge />}
        </span>
      }
    >
      {(activeChips.length > 0 || state.filter !== 'all') && (
        <ul className="flex flex-wrap gap-1.5 text-[12px]" aria-label="Active filters">
          {state.filter !== 'all' && <li className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-ink2">{titleCase(state.filter.replace('_live', ' (live)'))}</li>}
          {activeChips.map(([k, v]) => (
            <li key={k} className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-ink2">{titleCase(k)}: {titleCase(String(v))}</li>
          ))}
        </ul>
      )}

      {(supportsSearch || STATUS_OPTIONS[state.recordKind]) && (
        <div className="flex flex-wrap items-center gap-2">
          {supportsSearch && (
            <label className="relative">
              <span className="sr-only">Search records</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink3" aria-hidden="true" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-9 w-44 rounded-[var(--r-md)] border border-line bg-surface pl-8 pr-2 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40" />
            </label>
          )}
          {STATUS_OPTIONS[state.recordKind] && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink2">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--r-md)] border border-line bg-surface px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                <option value="">Any</option>
                {STATUS_OPTIONS[state.recordKind]!.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
          )}
          {state.recordKind === 'work_orders' && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink2">
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-9 rounded-[var(--r-md)] border border-line bg-surface px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                <option value="">Any</option>
                {['urgent', 'normal', 'low'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {query.isLoading && !data ? (
        <SectionSkeleton height="h-72" />
      ) : query.isError && !data ? (
        <ErrorBlock message="These records could not be loaded. You may not have access to them." onRetry={() => query.refetch()} />
      ) : data && data.rows.length === 0 ? (
        <EmptyBlock title="No records match" body="Try clearing a filter. Totals here use the same rules as the report figure you opened." />
      ) : data ? (
        <>
          <ul aria-busy={query.isFetching} className={`divide-y divide-line rounded-[var(--r-md)] border border-line bg-surface ${query.isFetching ? 'opacity-70' : ''}`}>
            {data.rows.map((row) => (
              <li key={row.id} className="px-3 py-2.5 text-[13px]"><RecordRow kind={state.recordKind} row={row} /></li>
            ))}
          </ul>
          {data.truncated && <p className="text-[12px] text-[var(--caution)]">This list was capped at the reporting row limit, so the total may be understated.</p>}
          {data.meta.total > data.meta.per_page && (
            <div className="flex items-center justify-between text-[12.5px] text-ink3">
              <span>Page {data.meta.page} of {totalPages}</span>
              <div className="flex gap-1">
                <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${drawerButton} !p-1.5 disabled:opacity-40`}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className={`${drawerButton} !p-1.5 disabled:opacity-40`}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </ReportDrawer>
  )
}
