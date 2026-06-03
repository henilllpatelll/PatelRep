'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { GuestRequestDrawer } from '@/components/guest-requests/GuestRequestDrawer'
import { NewRequestModal } from '@/components/guest-requests/NewRequestModal'
import { HistoryTab } from '@/components/guest-requests/HistoryTab'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isSlaBreached(iso: string, slaMins = 240): boolean {
  return Date.now() - new Date(iso).getTime() > slaMins * 60000
}

function urgentFirst(a: GuestRequest, b: GuestRequest): number {
  if (a.priority === 'urgent' && b.priority !== 'urgent') return -1
  if (b.priority === 'urgent' && a.priority !== 'urgent') return 1
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

// ─── Kanban columns config ────────────────────────────────────────────────────

const COLUMNS = [
  {
    key: 'open' as const,
    label: 'Open',
    headerClass: 'bg-[var(--info-soft)] border-b border-[var(--info-line)] text-[var(--info)]',
    countClass: 'bg-[var(--info)] text-white',
    filter: (r: GuestRequest, _today: string) => r.status === 'open',
  },
  {
    key: 'in_progress' as const,
    label: 'In Progress',
    headerClass: 'bg-[var(--caution-soft)] border-b border-[var(--caution-line)] text-[var(--caution)]',
    countClass: 'bg-[var(--caution)] text-white',
    filter: (r: GuestRequest, _today: string) => r.status === 'in_progress',
  },
  {
    key: 'resolved_today' as const,
    label: 'Resolved Today',
    headerClass: 'bg-[var(--ready-soft)] border-b border-[var(--ready-line)] text-[var(--ready)]',
    countClass: 'bg-[var(--ready)] text-white',
    filter: (r: GuestRequest, today: string) =>
      r.status === 'resolved' && (r.resolved_at ?? '').startsWith(today),
  },
]

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  request: GuestRequest
  confirmingId: string | null
  onStartConfirm: (id: string) => void
  onCancelConfirm: () => void
  onConfirmResolve: (id: string) => void
  onStart: (id: string) => void
  onCardClick: (r: GuestRequest) => void
  isUpdating: boolean
}

function GuestRequestCard({
  request,
  confirmingId,
  onStartConfirm,
  onCancelConfirm,
  onConfirmResolve,
  onStart,
  onCardClick,
  isUpdating,
}: CardProps) {
  const isUrgent = (request as any).priority === 'urgent'
  const isConfirming = confirmingId === request.id
  const slaBreached = request.status !== 'resolved' && isSlaBreached(request.created_at)
  const roomNum = request.rooms?.room_number ?? '—'

  return (
    <div
      onClick={() => onCardClick(request)}
      className={cn(
        'bg-surface rounded-[var(--r-md)] p-3 cursor-pointer hover:shadow-md transition-all',
        isUrgent ? 'border-2 border-[var(--alert)]' : 'border border-line'
      )}
    >
      {isUrgent && (
        <div className="mb-2">
          <Pill tone="alert" size="sm">URGENT</Pill>
        </div>
      )}

      <p className="font-mono text-[20px] font-bold text-ink leading-tight">{roomNum}</p>

      <p className="mt-1 text-[12.5px] text-ink2 line-clamp-2 leading-snug">
        {request.title}
      </p>

      <p className={cn('mt-1.5 text-[11px] flex items-center gap-0.5', slaBreached ? 'text-[var(--alert)] font-medium' : 'text-ink3')}>
        <Clock size={10} className="shrink-0" />
        <span>{timeAgo(request.created_at)}{slaBreached ? ' · SLA overdue' : ''}</span>
      </p>

      {request.status !== 'resolved' && (
        <div className="mt-2.5 flex gap-1.5" onClick={e => e.stopPropagation()}>
          {request.status === 'open' && (
            <Button
              variant="outline"
              className="flex-1 text-xs py-1.5 min-h-[30px]"
              disabled={isUpdating}
              onClick={() => onStart(request.id)}
            >
              Start
            </Button>
          )}
          {request.status === 'in_progress' && !isConfirming && (
            <Button
              variant="secondary"
              className="flex-1 text-xs py-1.5 min-h-[30px]"
              disabled={isUpdating}
              onClick={() => onStartConfirm(request.id)}
            >
              Resolve
            </Button>
          )}
          {request.status === 'in_progress' && isConfirming && (
            <>
              <Button
                variant="primary"
                className="flex-1 text-xs py-1.5 min-h-[30px]"
                disabled={isUpdating}
                onClick={() => onConfirmResolve(request.id)}
              >
                Confirm
              </Button>
              <Button
                variant="ghost"
                className="text-xs py-1.5 min-h-[30px] px-2.5"
                onClick={onCancelConfirm}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GuestRequestsPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [drawerRequest, setDrawerRequest] = useState<GuestRequest | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const today = new Date().toISOString().split('T')[0]

  const { data, isLoading } = useQuery({
    queryKey: ['guest-requests-kanban'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof guestRequestsApi.updateRequest>[1] }) =>
      guestRequestsApi.updateRequest(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['guest-requests-history'] })
      setConfirmingId(null)
    },
  })

  const allRequests: GuestRequest[] = (data as any)?.data ?? []
  const columns = COLUMNS.map(col => ({
    ...col,
    requests: allRequests.filter(r => col.filter(r, today)).sort(urgentFirst),
  }))

  const handleStart = useCallback(
    (id: string) => updateMutation.mutate({ id, payload: { status: 'in_progress' } }),
    [updateMutation]
  )

  const handleConfirmResolve = useCallback(
    (id: string) => updateMutation.mutate({ id, payload: { status: 'resolved' } }),
    [updateMutation]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold text-ink tracking-tight">Guest Requests</h1>
          <p className="text-[13px] text-ink3 mt-0.5">Track and resolve guest service requests</p>
        </div>
        <Button variant="primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} />
          New Request
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line bg-surface px-6 shrink-0">
        {(['active', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-3 text-[13.5px] font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-ink3 hover:text-ink'
            )}
          >
            {tab === 'active' ? 'Active Requests' : 'History'}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'active' ? (
        <div className="flex-1 overflow-hidden p-5">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-4 h-full">
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 h-full min-h-0">
              {columns.map(col => (
                <div key={col.key} className="flex flex-col rounded-[var(--r-lg)] border border-line overflow-hidden">
                  <div className={cn('flex items-center justify-between px-3.5 py-2.5 shrink-0', col.headerClass)}>
                    <span className="text-[12px] font-semibold uppercase tracking-[0.08em]">
                      {col.label}
                    </span>
                    <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center', col.countClass)}>
                      {col.requests.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-surface-2">
                    {col.requests.length === 0 ? (
                      <div className="py-10 text-center text-[12px] text-ink3">No requests</div>
                    ) : (
                      col.requests.map(request => (
                        <GuestRequestCard
                          key={request.id}
                          request={request}
                          confirmingId={confirmingId}
                          onStartConfirm={setConfirmingId}
                          onCancelConfirm={() => setConfirmingId(null)}
                          onConfirmResolve={handleConfirmResolve}
                          onStart={handleStart}
                          onCardClick={r => {
                            setConfirmingId(null)
                            setDrawerRequest(r)
                          }}
                          isUpdating={updateMutation.isPending}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <HistoryTab />
        </div>
      )}

      <GuestRequestDrawer
        request={drawerRequest}
        isOpen={!!drawerRequest}
        onClose={() => setDrawerRequest(null)}
        onNoteAdded={() => queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })}
      />

      <NewRequestModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })}
      />
    </div>
  )
}
