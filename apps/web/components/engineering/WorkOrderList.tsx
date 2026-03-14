'use client'

import { useQuery } from '@tanstack/react-query'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { WorkOrderCard } from './WorkOrderCard'
import { ClipboardList } from 'lucide-react'

interface Props {
  status: string
  category?: string
  priority?: string
  onSelect: (wo: WorkOrder) => void
}

const EMPTY_MESSAGES: Record<string, string> = {
  open: 'No open work orders. All caught up!',
  in_progress: 'No work orders currently in progress.',
  on_hold: 'No work orders on hold.',
  completed: 'No completed work orders yet.',
  cancelled: 'No cancelled work orders.',
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
        <p className="text-sm text-red-600">Failed to load work orders. Please try again.</p>
      </div>
    )
  }

  const workOrders: WorkOrder[] = data?.data ?? []

  if (!workOrders.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">
          {EMPTY_MESSAGES[status] ?? `No ${status.replace(/_/g, ' ')} work orders.`}
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
