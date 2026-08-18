'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Plus, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Pill } from '@/components/ui/primitives'
import { GuestRequestDrawer } from '@/components/guest-requests/GuestRequestDrawer'
import { NewRequestModal } from '@/components/guest-requests/NewRequestModal'
import { HistoryTab } from '@/components/guest-requests/HistoryTab'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { StateBlock } from '@/components/ui/StateBlock'
import { PageHeader } from '@/components/shared/PageHeader'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function timeAgoV2(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 60) return t('guestRequests.timeAgo.minutes', { count: diff })
  const h = Math.floor(diff / 60)
  if (h < 24) return t('guestRequests.timeAgo.hours', { count: h })
  return t('guestRequests.timeAgo.days', { count: Math.floor(h / 24) })
}

function isSlaBreached(request: GuestRequest): boolean {
  const dueAt = request.due_at
  return !!dueAt && request.status !== 'verified' && request.status !== 'cancelled' && Date.now() > new Date(dueAt).getTime()
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
    key: 'acknowledged' as const,
    label: 'Acknowledged',
    headerClass: 'bg-[var(--caution-soft)] border-b border-[var(--caution-line)] text-[var(--caution)]',
    countClass: 'bg-[var(--caution)] text-white',
    filter: (r: GuestRequest, _today: string) => r.status === 'acknowledged' || r.status === 'dispatched' || r.status === 'arrived' || r.status === 'guest_contacted',
  },
  {
    key: 'resolved_today' as const,
    label: 'Verify Resolution',
    headerClass: 'bg-[var(--ready-soft)] border-b border-[var(--ready-line)] text-[var(--ready)]',
    countClass: 'bg-[var(--ready)] text-white',
    filter: (r: GuestRequest, today: string) =>
      r.status === 'resolved',
  },
]

// v2 kanban column labels are keyed by 'verify' rather than 'resolved_today' in the locale file.
const COLUMN_I18N_KEY: Record<typeof COLUMNS[number]['key'], 'open' | 'acknowledged' | 'verify'> = {
  open: 'open',
  acknowledged: 'acknowledged',
  resolved_today: 'verify',
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  request: GuestRequest
  onAdvance: (id: string, status: Exclude<GuestRequest['status'], 'open'>) => void
  onCardClick: (r: GuestRequest) => void
  isUpdating: boolean
  v2: boolean
}

function GuestRequestCard({
  request,
  onAdvance,
  onCardClick,
  isUpdating,
  v2,
}: CardProps) {
  const { t } = useTranslation()
  const isUrgent = (request as any).priority === 'urgent'
  const slaBreached = isSlaBreached(request)
  const roomNum = request.rooms?.room_number ?? '—'

  return (
    <Card
      onClick={() => onCardClick(request)}
      className={cn(
        'rounded-[var(--r-md)] p-3 hover:shadow-md',
        isUrgent && 'border-2 border-[var(--alert)]'
      )}
    >
      {isUrgent && (
        <div className="mb-2">
          <Pill tone="alert" size="sm">{v2 ? t('guestRequests.urgent') : 'URGENT'}</Pill>
        </div>
      )}

      <p className="font-mono text-[20px] font-bold text-ink leading-tight">{roomNum}</p>

      <p className="mt-1 text-[12.5px] text-ink2 line-clamp-2 leading-snug">
        {request.title}
      </p>

      <p className={cn('mt-1.5 text-[11px] flex items-center gap-0.5', slaBreached ? 'text-[var(--alert)] font-medium' : 'text-ink3')}>
        <Clock size={10} className="shrink-0" />
        <span>
          {v2 ? timeAgoV2(request.created_at, t) : timeAgo(request.created_at)}
          {slaBreached ? ` · ${v2 ? t('guestRequests.slaOverdue') : 'SLA overdue'}` : ''}
        </span>
      </p>

      {request.status !== 'verified' && request.status !== 'cancelled' && (
        <div className="mt-2.5 flex gap-1.5" onClick={e => e.stopPropagation()}>
          {request.status === 'open' && (
            <Button
              variant="outline"
              className="flex-1 text-xs py-1.5 min-h-[30px]"
              disabled={isUpdating}
              onClick={() => onAdvance(request.id, 'acknowledged')}
            >
              {v2 ? t('guestRequests.actionAcknowledge') : 'Acknowledge'}
            </Button>
          )}
          {request.status === 'acknowledged' && (
            <Button
              variant="secondary"
              className="flex-1 text-xs py-1.5 min-h-[30px]"
              disabled={isUpdating}
              onClick={() => onAdvance(request.id, 'dispatched')}
            >
              {v2 ? t('guestRequests.actionDispatch') : 'Dispatch'}
            </Button>
          )}
          {request.status === 'dispatched' && (
            <Button variant="secondary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'arrived')}>
              {v2 ? t('guestRequests.actionArrived') : 'Arrived'}
            </Button>
          )}
          {request.status === 'arrived' && (
            <Button variant="secondary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'guest_contacted')}>
              {v2 ? t('guestRequests.actionContacted') : 'Contacted'}
            </Button>
          )}
          {request.status === 'guest_contacted' && (
            <Button variant="primary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'resolved')}>
              {v2 ? t('guestRequests.actionResolve') : 'Resolve'}
            </Button>
          )}
          {request.status === 'resolved' && (
            <Button variant="primary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'verified')}>
              {v2 ? t('guestRequests.actionVerify') : 'Verify'}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GuestRequestsPage() {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('guestRequests', hotel)
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [drawerRequest, setDrawerRequest] = useState<GuestRequest | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const appliedFocusRef = useRef<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guest-requests-kanban'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<GuestRequest['status'], 'open'> }) =>
      guestRequestsApi.transitionRequest(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })
      queryClient.invalidateQueries({ queryKey: ['guest-requests-history'] })
    },
  })

  const allRequests: GuestRequest[] = useMemo(() => (data as any)?.data ?? [], [data])
  const columns = COLUMNS.map(col => ({
    ...col,
    requests: allRequests.filter(r => col.filter(r, today)).sort(urgentFirst),
  }))

  const handleAdvance = useCallback(
    (id: string, status: Exclude<GuestRequest['status'], 'open'>) => updateMutation.mutate({ id, status }),
    [updateMutation]
  )

  // The drawer holds its own `request` snapshot captured at click time, so a
  // successful advance mutation (which only invalidates the kanban query) would
  // otherwise leave the open drawer showing the pre-transition status — clicking
  // the same (now-stale) advance button again re-sends the already-applied status
  // as the "next" status, which the backend's state machine correctly rejects
  // with a 422 (see .wolf/buglog.json). Keep the open drawer's copy in sync with
  // the latest fetched data so its buttons always reflect the real current status.
  useEffect(() => {
    if (!drawerRequest) return
    const fresh = allRequests.find(r => r.id === drawerRequest.id)
    if (fresh && fresh !== drawerRequest) setDrawerRequest(fresh)
  }, [allRequests, drawerRequest])

  // Deep link: open the drawer for a specific request (?focus=<id>)
  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId || appliedFocusRef.current === focusId) return
    const target = allRequests.find(r => r.id === focusId)
    if (!target) return // graceful no-op: deleted/stale/cross-tenant id
    appliedFocusRef.current = focusId
    setActiveTab('active')
    setDrawerRequest(target)
  }, [searchParams, allRequests])

  if (v2) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 pt-4 bg-surface shrink-0">
          <PageHeader
            title={t('guestRequests.pageTitle')}
            subtitle={t('guestRequests.pageSubtitle')}
            tabs={[
              { label: t('guestRequests.tabActive'), active: activeTab === 'active', onClick: () => setActiveTab('active') },
              { label: t('guestRequests.tabHistory'), active: activeTab === 'history', onClick: () => setActiveTab('history') },
            ]}
            actions={
              <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                <Plus size={16} />
                {t('guestRequests.newRequestButton')}
              </Button>
            }
          />
        </div>

        {/* Content */}
        {activeTab === 'active' ? (
          <div className="flex-1 overflow-hidden p-5">
            {isLoading ? (
              <div className="grid grid-cols-3 gap-4 h-full">
                {[0, 1, 2].map(i => (
                  <div key={i} className="bg-surface-2 border border-line-2 rounded-[var(--r-lg)] animate-pulse" />
                ))}
              </div>
            ) : isError ? (
              <StateBlock status="error" error={{ message: t('guestRequests.loadError'), onRetry: () => refetch() }} />
            ) : (
              <div className="grid grid-cols-3 gap-4 h-full min-h-0">
                {columns.map(col => (
                  <div key={col.key} data-testid={`gr-column-${col.key}`} className="flex flex-col rounded-[var(--r-lg)] border border-line overflow-hidden">
                    <div className={cn('flex items-center justify-between px-3.5 py-2.5 shrink-0', col.headerClass)}>
                      <span className="text-[12px] font-semibold uppercase tracking-[0.08em]">
                        {t(`guestRequests.columns.${COLUMN_I18N_KEY[col.key]}`)}
                      </span>
                      <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center', col.countClass)}>
                        {col.requests.length}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-surface-2">
                      {col.requests.length === 0 ? (
                        <StateBlock status="empty" empty={{ title: t('guestRequests.empty.title') }} />
                      ) : (
                        col.requests.map(request => (
                          <GuestRequestCard
                            key={request.id}
                            request={request}
                            onAdvance={handleAdvance}
                            onCardClick={r => {
                              setDrawerRequest(r)
                            }}
                            isUpdating={updateMutation.isPending}
                            v2
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
          onAdvance={handleAdvance}
          isUpdating={updateMutation.isPending}
        />

        <NewRequestModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })}
        />
      </div>
    )
  }

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
                <div key={col.key} data-testid={`gr-column-${col.key}`} className="flex flex-col rounded-[var(--r-lg)] border border-line overflow-hidden">
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
                          onAdvance={handleAdvance}
                          onCardClick={r => {
                            setDrawerRequest(r)
                          }}
                          isUpdating={updateMutation.isPending}
                          v2={false}
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
        onAdvance={handleAdvance}
        isUpdating={updateMutation.isPending}
      />

      <NewRequestModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })}
      />
    </div>
  )
}
