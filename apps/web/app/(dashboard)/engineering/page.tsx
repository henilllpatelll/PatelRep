'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { engineeringApi } from '@/lib/api/engineering'
import { WorkOrderCard } from '@/components/engineering/WorkOrderCard'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { FailurePredictionSidebar } from '@/components/engineering/FailurePredictionSidebar'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import type { WorkOrder } from '@/lib/api/engineering'

const KANBAN_STATUSES = ['open', 'in_progress', 'completed'] as const
type KanbanStatus = typeof KANBAN_STATUSES[number]

const STATUS_LABELS: Record<KanbanStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
}

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'structural', label: 'Structural' },
  { value: 'safety', label: 'Safety' },
  { value: 'general', label: 'General' },
]

const PRIORITIES = [
  { value: '', label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-16 bg-stone-200 rounded" />
            <div className="h-3 w-12 bg-stone-200 rounded-full" />
          </div>
          <div className="h-4 w-3/4 bg-stone-200 rounded" />
          <div className="h-3 w-1/2 bg-stone-200 rounded" />
        </div>
        <div className="shrink-0 space-y-1.5">
          <div className="h-5 w-20 bg-stone-200 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export default function EngineeringPage() {
  const { role, isGM } = useRole()
  const isChief = role === 'chief_engineer'
  const isEngineer = role === 'engineer'
  const canCreate = isGM || isChief || isEngineer

  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('')
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const results = useQueries({
    queries: KANBAN_STATUSES.map(status => ({
      queryKey: ['work-orders', status, category, priority],
      queryFn: () => engineeringApi.listWorkOrders({ status, category: category || undefined, priority: priority || undefined }),
      staleTime: 30_000,
    })),
  })

  const isLoading = results.some(r => r.isLoading)
  const isError = results.some(r => r.isError)

  const workOrdersByStatus: Record<KanbanStatus, WorkOrder[]> = {
    open: results[0]?.data?.data ?? [],
    in_progress: results[1]?.data?.data ?? [],
    completed: results[2]?.data?.data ?? [],
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Main content */}
      <div className="flex-1 space-y-4 min-w-0">

        {/* Header row */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Engineering</h1>
          {canCreate && (
            <Button
              variant="primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus className="w-4 h-4" />
              New Work Order
            </Button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1" />

          {/* Category filter */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-amber-200/40 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="border border-amber-200/40 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error state */}
        {isError && (
          <div className="text-center py-8">
            <p className="text-sm text-red-600">Failed to load work orders. Please try again.</p>
          </div>
        )}

        {/* Kanban board */}
        <div className="grid grid-cols-3 gap-4">
          {KANBAN_STATUSES.map((status) => {
            const filteredWOs = workOrdersByStatus[status]
            return (
              <div key={status} className="bg-stone-50 rounded-2xl p-3 min-h-[400px]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                    {STATUS_LABELS[status]}
                  </h3>
                  <span className="text-xs text-stone-400 bg-stone-200 rounded-full px-2 py-0.5">
                    {filteredWOs.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {isLoading ? (
                    <>
                      <SkeletonCard />
                      <SkeletonCard />
                    </>
                  ) : filteredWOs.length === 0 ? (
                    <p className="text-xs text-stone-400 text-center py-8">No {STATUS_LABELS[status].toLowerCase()} work orders</p>
                  ) : (
                    filteredWOs.map(wo => (
                      <WorkOrderCard key={wo.id} wo={wo} onClick={setSelectedWO} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sidebar */}
      <FailurePredictionSidebar />

      {/* Detail drawer */}
      <WorkOrderDetailDrawer
        wo={selectedWO}
        isOpen={!!selectedWO}
        onClose={() => setSelectedWO(null)}
        onUpdate={() => {
          setSelectedWO(null)
        }}
      />

      {/* Create modal */}
      <CreateWorkOrderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(wo) => {
          setShowCreateModal(false)
          setSelectedWO(wo)
        }}
      />
    </div>
  )
}
