'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bed, ClipboardList, Plus, Search, Users, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { engineeringApi } from '@/lib/api/engineering'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import type { LogbookRelatedType } from '@/lib/api/logbook'
import type { RoomStatus } from '@/lib/api/rooms'
import { tasksApi, type Task } from '@/lib/api/tasks'
import type { LogbookRelatedItem } from '@/lib/utils/logbookDisplay'
import { cn } from '@/lib/utils'

const LINK_TYPES: LogbookRelatedType[] = ['room', 'work_order', 'guest_request', 'task']
const ACTIVE_WORK_ORDER_STATUSES = new Set(['open', 'escalated', 'in_progress', 'on_hold'])
const ACTIVE_GUEST_REQUEST_STATUSES = new Set(['open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'reopened'])

interface Candidate {
  id: string
  title: string
  subtitle?: string
  status?: string
}

function linkTypeIcon(type: LogbookRelatedType, size = 14) {
  switch (type) {
    case 'room': return <Bed size={size} aria-hidden="true" />
    case 'work_order': return <Wrench size={size} aria-hidden="true" />
    case 'guest_request': return <Users size={size} aria-hidden="true" />
    case 'task': return <ClipboardList size={size} aria-hidden="true" />
  }
}

interface RelatedItemPickerProps {
  value: LogbookRelatedItem | null
  onChange: (item: LogbookRelatedItem | null) => void
  rooms: RoomStatus[]
}

/** Single-item polymorphic linker for room/task/work-order/guest-request records.
 * Tenant/type validation is re-checked server-side on submit (spec #30) — this
 * picker only narrows candidates to reduce noise, it is not the security boundary. */
export function RelatedItemPicker({ value, onChange, rooms }: RelatedItemPickerProps) {
  const { t } = useTranslation()
  const [activeType, setActiveType] = useState<LogbookRelatedType | null>(null)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeType) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) { setActiveType(null); setQuery('') }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [activeType])

  const workOrdersQuery = useQuery({
    queryKey: ['logbook-link-work-orders'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 50, sort_by: 'priority', sort_dir: 'desc' }),
    enabled: activeType === 'work_order',
    staleTime: 30_000,
  })
  const tasksQuery = useQuery({
    queryKey: ['logbook-link-tasks'],
    queryFn: () => tasksApi.list({ status: 'open', per_page: 50 }) as Promise<{ data: Task[] }>,
    enabled: activeType === 'task',
    staleTime: 30_000,
  })
  const guestRequestsQuery = useQuery({
    queryKey: ['logbook-link-guest-requests'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 50 }),
    enabled: activeType === 'guest_request',
    staleTime: 30_000,
  })

  const candidates = useMemo((): Candidate[] => {
    const q = query.trim().toLowerCase()
    if (activeType === 'room') {
      return rooms
        .filter((room) => !q || room.rooms?.room_number?.toLowerCase().includes(q))
        .map((room) => ({ id: room.room_id, title: t('logbook.roomLinkTitle', { number: room.rooms?.room_number ?? '—' }) }))
    }
    if (activeType === 'work_order') {
      return (workOrdersQuery.data?.data ?? [])
        .filter((wo) => ACTIVE_WORK_ORDER_STATUSES.has(wo.status))
        .filter((wo) => !q || wo.title.toLowerCase().includes(q) || String(wo.work_order_number).includes(q))
        .map((wo) => ({
          id: wo.id,
          title: t('logbook.workOrderLinkTitle', { number: wo.work_order_number, title: wo.title }),
          status: wo.status,
        }))
    }
    if (activeType === 'guest_request') {
      return (guestRequestsQuery.data?.data ?? [])
        .filter((gr) => ACTIVE_GUEST_REQUEST_STATUSES.has(gr.status))
        .filter((gr) => !q || gr.title.toLowerCase().includes(q))
        .map((gr) => ({
          id: gr.id,
          title: gr.rooms?.room_number ? t('logbook.roomLinkedTitle', { number: gr.rooms.room_number, title: gr.title }) : gr.title,
          status: gr.status,
        }))
    }
    if (activeType === 'task') {
      return (tasksQuery.data?.data ?? [])
        .filter((task) => !q || task.title.toLowerCase().includes(q))
        .map((task) => ({
          id: task.id,
          title: task.rooms?.room_number ? t('logbook.roomLinkedTitle', { number: task.rooms.room_number, title: task.title }) : task.title,
          subtitle: t(`logbook.linkTypes.task`),
          status: task.status,
        }))
    }
    return []
  }, [activeType, query, rooms, workOrdersQuery.data, guestRequestsQuery.data, tasksQuery.data, t])

  const isLoading = (activeType === 'work_order' && workOrdersQuery.isLoading)
    || (activeType === 'task' && tasksQuery.isLoading)
    || (activeType === 'guest_request' && guestRequestsQuery.isLoading)

  function select(candidate: Candidate) {
    if (!activeType) return
    onChange({ type: activeType, id: candidate.id, title: candidate.title, subtitle: candidate.subtitle, status: candidate.status })
    setActiveType(null)
    setQuery('')
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('logbook.linkTo')}>
        {LINK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveType((current: LogbookRelatedType | null) => (current === type ? null : type))}
            aria-pressed={activeType === type}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              activeType === type ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2',
            )}
          >
            <Plus size={13} aria-hidden="true" />
            {t(`logbook.linkTypes.${type}`)}
          </button>
        ))}
      </div>

      {activeType && (
        <div className="rounded-[var(--r-md)] border border-line bg-surface p-2 shadow-pop">
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink4" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('logbook.linkSearchPlaceholder')}
              aria-label={t('logbook.linkSearchPlaceholder')}
              className="w-full rounded border border-line bg-surface-2 py-1.5 pl-7 pr-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            />
          </div>
          <div role="listbox" aria-label={t(`logbook.linkTypes.${activeType}`)} className="max-h-48 overflow-y-auto">
            {isLoading ? (
              <p className="px-2 py-2 text-xs text-ink3">{t('common.loading')}</p>
            ) : candidates.length === 0 ? (
              <p className="px-2 py-2 text-xs text-ink3">{t('logbook.noLinkCandidates')}</p>
            ) : candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={value?.id === candidate.id}
                onClick={() => select(candidate)}
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-ink2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {candidate.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {value && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.linked')}</p>
          <div className="flex items-center justify-between gap-2 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              {linkTypeIcon(value.type)}
              <span className="truncate">{value.title}</span>
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t('logbook.removeLink')}
              className="shrink-0 text-ink4 hover:text-ink2"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
