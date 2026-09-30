'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { engineeringApi } from '@/lib/api/engineering'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import type { LogbookRelatedType } from '@/lib/api/logbook'
import { roomsApi } from '@/lib/api/rooms'
import { tasksApi } from '@/lib/api/tasks'
import { Pill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { relatedTypeLabel } from '@/lib/utils/logbookDisplay'

interface Resolved {
  title: string
  subtitle?: string
  status?: string
  href: string
}

function deepLinkFor(type: LogbookRelatedType, id: string): string {
  if (type === 'task') return `/tasks?focus=${encodeURIComponent(id)}`
  if (type === 'guest_request') return `/tasks?type=guest_request&focus=${encodeURIComponent(id)}`
  if (type === 'work_order') return `/engineering?tab=work-orders&focus=${encodeURIComponent(id)}`
  return '/housekeeping'
}

interface LogbookLinkedItemCardProps {
  relatedType: LogbookRelatedType
  relatedId: string
}

export function LogbookLinkedItemCard({ relatedType, relatedId }: LogbookLinkedItemCardProps) {
  const { t } = useTranslation()
  const router = useRouter()

  const roomQuery = useQuery({
    queryKey: ['logbook-linked-room', relatedId],
    queryFn: () => roomsApi.get(relatedId) as Promise<{ data: any }>,
    enabled: relatedType === 'room',
    retry: false,
  })
  const taskQuery = useQuery({
    queryKey: ['logbook-linked-task', relatedId],
    queryFn: () => tasksApi.get(relatedId) as Promise<{ data: any }>,
    enabled: relatedType === 'task',
    retry: false,
  })
  const workOrderQuery = useQuery({
    queryKey: ['logbook-linked-work-order', relatedId],
    queryFn: () => engineeringApi.getWorkOrder(relatedId),
    enabled: relatedType === 'work_order',
    retry: false,
  })
  const guestRequestQuery = useQuery({
    queryKey: ['logbook-linked-guest-request'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 100 }),
    enabled: relatedType === 'guest_request',
    staleTime: 30_000,
  })

  const isLoading = roomQuery.isLoading || taskQuery.isLoading || workOrderQuery.isLoading || guestRequestQuery.isLoading

  function resolve(): Resolved | null {
    if (relatedType === 'room') {
      const room = roomQuery.data?.data
      if (!room) return null
      const status = Array.isArray(room.room_status) ? room.room_status[0] : room.room_status
      return {
        title: t('logbook.roomLinkTitle', { number: room.room_number ?? '—' }),
        status: status?.status,
        href: deepLinkFor('room', relatedId),
      }
    }
    if (relatedType === 'task') {
      const task = taskQuery.data?.data
      if (!task) return null
      return { title: task.title, status: task.status, href: deepLinkFor('task', relatedId) }
    }
    if (relatedType === 'work_order') {
      const wo = workOrderQuery.data?.data
      if (!wo) return null
      return {
        title: t('logbook.workOrderLinkTitle', { number: wo.work_order_number, title: wo.title }),
        status: wo.status,
        href: deepLinkFor('work_order', relatedId),
      }
    }
    if (relatedType === 'guest_request') {
      const match = guestRequestQuery.data?.data.find((request) => request.id === relatedId)
      if (!match) return null
      return {
        title: match.rooms?.room_number ? t('logbook.roomLinkedTitle', { number: match.rooms.room_number, title: match.title }) : match.title,
        status: match.status,
        href: deepLinkFor('guest_request', relatedId),
      }
    }
    return null
  }

  const failed = [roomQuery, taskQuery, workOrderQuery].some((q) => q.isError)
    || (relatedType === 'guest_request' && guestRequestQuery.isSuccess && !guestRequestQuery.data?.data.some((request) => request.id === relatedId))
  const resolved = !isLoading ? resolve() : null

  return (
    <section aria-labelledby="logbook-linked-work-heading">
      <p id="logbook-linked-work-heading" className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.linkedWork')}</p>
      {isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : failed || !resolved ? (
        <p className="text-sm text-ink3">{t('logbook.linkedItemUnavailable')}</p>
      ) : (
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-ink">{resolved.title}</p>
            {resolved.status && <Pill tone="neutral" size="sm">{resolved.status}</Pill>}
          </div>
          <button
            type="button"
            onClick={() => router.push(resolved.href)}
            className="mt-2 text-sm font-medium text-accent hover:underline"
          >
            {t('logbook.openLinked', { label: relatedTypeLabel(t, relatedType) })}
          </button>
        </div>
      )}
    </section>
  )
}
