'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wrench, Search, AlertCircle, CheckCircle2, Plus } from 'lucide-react'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { FailurePredictionSidebar } from '@/components/engineering/FailurePredictionSidebar'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusTab = 'open' | 'in_progress' | 'on_hold' | 'completed'
type BadgeVariant = 'high' | 'medium' | 'low' | 'default'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
]

const PRIORITY_VARIANT: Record<string, BadgeVariant> = {
  urgent: 'high',
  normal: 'medium',
  low: 'low',
}

const STATUS_TRANSITIONS: Record<StatusTab, { label: string; next: string } | null> = {
  open: { label: 'Start', next: 'in_progress' },
  in_progress: { label: 'Complete', next: 'completed' },
  on_hold: { label: 'Resume', next: 'in_progress' },
  completed: null,
}

// ── Row ───────────────────────────────────────────────────────────────────────

function WorkOrderRow({
  wo,
  canAdvance,
  onStatusChange,
}: {
  wo: WorkOrder
  canAdvance: boolean
  onStatusChange: (id: string, status: string) => void
}) {
  const transition = STATUS_TRANSITIONS[wo.status as StatusTab]

  return (
    <div className="flex items-start gap-3 p-4 bg-white/70 rounded-xl border border-white/90 hover:shadow-sm transition-shadow">
      {/* Priority indicator */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
          wo.priority === 'urgent' ? 'bg-red-50' : 'bg-amber-50'
        }`}
      >
        <Wrench
          className={`w-3.5 h-3.5 ${
            wo.priority === 'urgent' ? 'text-red-500' : 'text-amber-600'
          }`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-900">
            WO-{wo.work_order_number}
          </span>
          <Badge variant={PRIORITY_VARIANT[wo.priority] ?? 'default'}>
            {wo.priority}
          </Badge>
        </div>
        <p className="text-sm text-gray-800 leading-snug truncate">{wo.title}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-400">
          {wo.rooms?.room_number && <span>Room {wo.rooms.room_number}</span>}
          {wo.location_text && !wo.rooms?.room_number && (
            <span className="truncate max-w-[200px]">{wo.location_text}</span>
          )}
          <span className="capitalize">{wo.category.replace(/_/g, ' ')}</span>
          {wo.due_at && (
            <span className="text-amber-600">
              Due {new Date(wo.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        {wo.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{wo.description}</p>
        )}
      </div>

      {/* Action */}
      {canAdvance && transition && (
        <button
          onClick={() => onStatusChange(wo.id, transition.next)}
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors bg-white border-gray-200 text-gray-700 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50"
        >
          {transition.label}
        </button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

export default function WorkOrdersPage() {
  const { role } = useRole()
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)
  const queryClient = useQueryClient()
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState<StatusTab>('open')
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const isEngineer = role === 'engineer'
  const canManage = role === 'chief_engineer' || role === 'gm'

  useEffect(() => {
    if (!hotelId) return
    const channel = supabase
      .channel('wo_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `tenant_id=eq.${hotelId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [hotelId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isError } = useQuery({
    queryKey: ['work-orders', activeTab, isEngineer ? user?.id : null],
    queryFn: () =>
      engineeringApi.listWorkOrders({
        status: activeTab,
        assigned_to: isEngineer ? user?.id : undefined,
        per_page: 50,
      }),
    refetchInterval: 60_000,
  })

  const workOrders: WorkOrder[] = data?.data ?? []

  const filtered = workOrders.filter((wo) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      wo.title.toLowerCase().includes(q) ||
      wo.rooms?.room_number?.includes(q) ||
      String(wo.work_order_number).includes(q) ||
      wo.category.includes(q)
    )
  })

  // Sort: urgent first, then by created_at desc
  const sorted = [...filtered].sort((a, b) => {
    const priorityOrder = { urgent: 0, normal: 1, low: 2 }
    const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1
    const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1
    if (pa !== pb) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      engineeringApi.updateWorkOrder(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    },
  })

  const handleStatusChange = (id: string, status: string) => {
    updateStatus({ id, status })
  }

  // Tab counts from current data (approximate — only counts loaded tab)
  const urgentCount = workOrders.filter(
    (wo) => wo.priority === 'urgent' && activeTab === 'open',
  ).length

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-5xl">
    <div className="flex-1 min-w-0 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Wrench className="w-5 h-5 text-amber-600 shrink-0" />
            Work Orders
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isEngineer ? 'Your assigned work orders' : 'All hotel work orders'}
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)} className="shrink-0">
            <Plus className="w-4 h-4" />
            New Work Order
          </Button>
        )}
      </div>

      {/* Urgent alert */}
      {urgentCount > 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
          <span className="font-medium">
            {urgentCount} urgent {urgentCount === 1 ? 'work order' : 'work orders'} require immediate attention
          </span>
        </div>
      )}

      {/* Status tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Tabs */}
        <div className="overflow-x-auto shrink-0">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm text-xs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3.5 py-2 font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by room, title, or WO number…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white/80 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white/60 rounded-xl animate-pulse border border-white/90" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <div className="py-8 text-center text-sm text-red-600">
            Failed to load work orders. Please refresh.
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              {search ? 'No work orders match your search.' : `No ${activeTab.replace('_', ' ')} work orders.`}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((wo) => (
            <WorkOrderRow
              key={wo.id}
              wo={wo}
              canAdvance={isEngineer || canManage}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateWorkOrderModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={() => {
            setShowCreateModal(false)
            queryClient.invalidateQueries({ queryKey: ['work-orders'] })
          }}
        />
      )}
    </div>
    <FailurePredictionSidebar />
  </div>
  )
}
