'use client'

/* Avatar photos can be hosted anywhere, so a plain <img> (not next/image) is intentional. */
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { getInitials } from '@/lib/utils/avatar'
import type {
  DirectoryEntry, DirectoryStatus, SortDir, SortKey, TodayState,
} from '@/lib/people/peopleDirectory'
import { PeopleRowActions, type RowActionHandlers } from './PeopleRowActions'
import { usePeopleLabels, type TodaySource } from './usePeopleLabels'

const STATUS_STYLE: Record<DirectoryStatus, { text: string; dot: string }> = {
  active: { text: 'text-[var(--ready)]', dot: 'bg-[var(--ready)]' },
  invited: { text: 'text-[var(--info,var(--accent))]', dot: 'bg-[var(--info,var(--accent))]' },
  expired: { text: 'text-[var(--caution)]', dot: 'bg-[var(--caution)]' },
  deactivated: { text: 'text-ink-3', dot: 'bg-ink-4' },
}

/** Text is always shown next to the dot, so colour is never the only signal. */
function StatusBadge({ status }: { status: DirectoryStatus }) {
  const { statusLabel } = usePeopleLabels()
  const s = STATUS_STYLE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function PersonAvatar({ entry, name, size }: { entry: DirectoryEntry; name: string; size: number }) {
  const [broken, setBroken] = useState(false)
  if (entry.avatarUrl && !broken) {
    return (
      <img
        src={entry.avatarUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-3 font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {getInitials(name)}
    </span>
  )
}

function TodayCell({ text }: { text: ReturnType<ReturnType<typeof usePeopleLabels>['todayText']> }) {
  if (!text.primary) return <Skeleton className="h-4 w-20" />
  return (
    <div className="min-w-0">
      <p className={cn('truncate text-[13px]', text.tone === 'muted' ? 'text-ink-3' : 'text-ink', text.tone === 'live' && 'font-medium')}>
        {text.primary}
      </p>
      {text.secondary && (
        <p className={cn('truncate text-[11px]', text.tone === 'live' ? 'text-[var(--ready)]' : 'text-ink-3')}>{text.secondary}</p>
      )}
    </div>
  )
}

interface DirectoryProps {
  entries: DirectoryEntry[]
  today: Map<string, TodayState> | undefined
  todaySource: TodaySource
  sort: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  handlers: RowActionHandlers
  busyKey: string | null
  /** Phase 3 integration point: opening a person's profile drawer. Rows are inert while this is unset. */
  onOpenEntry?: (entry: DirectoryEntry) => void
}

function useRowModel(props: DirectoryProps) {
  const labels = usePeopleLabels()
  return (entry: DirectoryEntry) => {
    const name = labels.displayName(entry)
    const state = entry.kind === 'staff' ? props.today?.get(entry.staff.user_id) : undefined
    return {
      name,
      role: labels.roleLabel(entry.role),
      today: labels.todayText(entry, state, props.todaySource),
    }
  }
}

function SortHeader({
  label, k, sort, dir, onSort, className,
}: { label: string; k: SortKey; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void; className?: string }) {
  const { t } = usePeopleLabels()
  const active = sort === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-label={t('people.sort.by', { column: label })}
      className={cn(
        'inline-flex items-center gap-1 rounded text-[10.5px] font-semibold uppercase tracking-[1px] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        active ? 'text-ink' : 'text-ink-3',
        className,
      )}
    >
      {label}
      {active && (dir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
    </button>
  )
}

export function PeopleDirectoryTable(props: DirectoryProps) {
  const { t } = usePeopleLabels()
  const row = useRowModel(props)
  const ariaSort = (k: SortKey) => (props.sort === k ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none')

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line bg-surface-2 text-left">
          <th scope="col" aria-sort={ariaSort('name')} className="px-6 py-3">
            <SortHeader label={t('people.columns.person')} k="name" sort={props.sort} dir={props.dir} onSort={props.onSort} />
          </th>
          <th scope="col" aria-sort={props.sort === 'role' ? ariaSort('role') : ariaSort('department')} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <SortHeader label={t('people.columns.department')} k="department" sort={props.sort} dir={props.dir} onSort={props.onSort} />
              <span className="text-ink-4" aria-hidden="true">/</span>
              <SortHeader label={t('people.columns.role')} k="role" sort={props.sort} dir={props.dir} onSort={props.onSort} />
            </div>
          </th>
          <th scope="col" className="px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">
            {t('people.columns.today')}
          </th>
          <th scope="col" aria-sort={ariaSort('status')} className="px-4 py-3">
            <SortHeader label={t('people.columns.account')} k="status" sort={props.sort} dir={props.dir} onSort={props.onSort} />
          </th>
          <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">{t('people.columns.actions')}</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-2">
        {props.entries.map((entry) => {
          const m = row(entry)
          const interactive = !!props.onOpenEntry
          return (
            <tr
              key={entry.key}
              onClick={interactive ? () => props.onOpenEntry?.(entry) : undefined}
              className={cn(
                'transition-colors duration-fast ease-standard hover:bg-surface-2 focus-within:bg-surface-2',
                interactive && 'cursor-pointer',
                entry.status === 'deactivated' && 'opacity-80',
              )}
            >
              <td className="px-6 py-3">
                <div className="flex items-center gap-3">
                  <PersonAvatar entry={entry} name={m.name} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{m.name}</p>
                    {entry.email && entry.email !== m.name && <p className="truncate text-[11px] text-ink-3">{entry.email}</p>}
                    {entry.phone && <p className="hidden truncate text-[11px] text-ink-3 xl:block">{entry.phone}</p>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <p className="truncate text-[13px] text-ink">{entry.departmentName ?? t('people.filters.unassigned')}</p>
                <p className="truncate text-[11px] text-ink-3">
                  {m.role}{entry.customRoleName ? ` · ${entry.customRoleName}` : ''}
                </p>
              </td>
              <td className="px-4 py-3"><TodayCell text={m.today} /></td>
              <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
              <td className="px-4 py-3 text-right">
                <PeopleRowActions entry={entry} name={m.name} handlers={props.handlers} busy={props.busyKey === entry.key} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function PeopleMobileCards(props: DirectoryProps) {
  const { t } = usePeopleLabels()
  const row = useRowModel(props)
  return (
    <ul className="grid gap-px bg-line-2 md:grid-cols-2">
      {props.entries.map((entry) => {
        const m = row(entry)
        const interactive = !!props.onOpenEntry
        return (
          <li
            key={entry.key}
            onClick={interactive ? () => props.onOpenEntry?.(entry) : undefined}
            className={cn('flex items-start gap-3 bg-surface px-4 py-3.5 active:bg-surface-2', interactive && 'cursor-pointer')}
          >
            <PersonAvatar entry={entry} name={m.name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-ink">{m.name}</p>
              <p className="truncate text-[12px] text-ink-2">
                {[entry.departmentName ?? t('people.filters.unassigned'), m.role].join(' · ')}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <TodayCell text={m.today} />
                <StatusBadge status={entry.status} />
              </div>
            </div>
            <PeopleRowActions entry={entry} name={m.name} handlers={props.handlers} busy={props.busyKey === entry.key} />
          </li>
        )
      })}
    </ul>
  )
}

export function PeopleDirectorySkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-line-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 lg:px-6">
          <Skeleton variant="circle" className="h-9 w-9" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-52 max-w-full" /></div>
          <Skeleton className="hidden h-4 w-24 lg:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}
