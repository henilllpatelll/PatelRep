'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { WorkOrderCard } from './WorkOrderCard'
import { ClipboardList } from 'lucide-react'

interface Props {
  status: string
  category?: string
  priority?: string
  onSelect: (wo: WorkOrder) => void
}

function getEmptyMessages(t: TFunction): Record<string, string> {
  return {
    open: t('engineering.workOrderList.emptyOpen'),
    escalated: t('engineering.workOrderList.emptyEscalated'),
    in_progress: t('engineering.workOrderList.emptyInProgress'),
    on_hold: t('engineering.workOrderList.emptyOnHold'),
    completed: t('engineering.workOrderList.emptyCompleted'),
    cancelled: t('engineering.workOrderList.emptyCancelled'),
  }
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/90 bg-white/[0.65] backdrop-blur-md p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-16 bg-gray-200 rounded" />
            <div className="h-3 w-12 bg-gray-200 rounded-full" />
          </div>
          <div className="h-4 w-3/4 bg-gray-200 rounded" />
          <div className="h-3 w-1/2 bg-gray-200 rounded" />
        </div>
        <div className="shrink-0 space-y-1.5">
          <div className="h-5 w-20 bg-gray-200 rounded-full" />
          <div className="h-3 w-16 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  )
}

export function WorkOrderList({ status, category, priority, onSelect }: Props) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['work-orders', status, category, priority],
    queryFn: () => engineeringApi.listWorkOrders({ status, category, priority }),
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-red-600">{t('engineering.workOrderList.loadError')}</p>
      </div>
    )
  }

  const workOrders: WorkOrder[] = data?.data ?? []

  if (!workOrders.length) {
    const emptyMessages = getEmptyMessages(t)
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">
          {emptyMessages[status] ?? t('engineering.workOrderList.emptyGeneric', { status: status.replace(/_/g, ' ') })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {workOrders.map((wo) => (
        <WorkOrderCard key={wo.id} wo={wo} onClick={onSelect} />
      ))}
    </div>
  )
}
