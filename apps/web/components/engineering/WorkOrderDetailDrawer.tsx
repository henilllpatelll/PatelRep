'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Clock,
  MapPin,
  Wrench,
  MessageSquare,
  Image,
  Loader2,
  CheckCircle,
  AlertTriangle,
  PauseCircle,
  XCircle,
  RotateCcw,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { engineeringApi, WorkOrder, WorkOrderComment } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'

interface Props {
  wo: WorkOrder | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
}

const CATEGORY_ICONS: Record<string, string> = {
  plumbing: '💧',
  electrical: '⚡',
  hvac: '❄️',
  furniture: '🪑',
  appliance: '🔌',
  structural: '🏗️',
  safety: '🛡️',
  general: '🔧',
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 border-red-200',
  normal: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  low: 'bg-gray-50 text-gray-500 border-gray-200',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-purple-50 text-purple-700',
  on_hold: 'bg-orange-50 text-orange-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

function formatTs(iso: string | undefined | null): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const time = format(d, 'h:mm a')
    if (isToday(d)) return `Today ${time}`
    if (isYesterday(d)) return `Yesterday ${time}`
    return `${format(d, 'MMM d')} ${time}`
  } catch {
    return iso
  }
}

function slaDisplay(dueAt: string, status: string): { text: string; overdue: boolean } | null {
  if (status === 'completed' || status === 'cancelled') return null
  const diff = new Date(dueAt).getTime() - Date.now()
  const overdue = diff < 0
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const suffix = overdue ? 'overdue' : 'left'
  let text: string
  if (h > 48) text = `${Math.floor(h / 24)}d ${suffix}`
  else if (h > 0) text = `${h}h ${m}m ${suffix}`
  else text = `${m}m ${suffix}`
  return { text, overdue }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
      {children}
    </h3>
  )
}

export function WorkOrderDetailDrawer({ wo, isOpen, onClose, onUpdate }: Props) {
  const { role, isGM } = useRole()
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)

  const isEngineer = role === 'engineer'
  const isChief = role === 'chief_engineer'
  const canClaim = (isEngineer || isChief || isGM) && wo?.status === 'open'
  const canComplete = (isEngineer || isChief || isGM) && wo?.status === 'in_progress'
  const canHold = (isChief || isGM) && wo?.status === 'in_progress'
  const canCancel = (isChief || isGM) && (wo?.status === 'open' || wo?.status === 'on_hold')
  const canReopen = (isChief || isGM) && wo?.status === 'on_hold'

  // Completion form state
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [partsUsed, setPartsUsed] = useState('')

  // Comment state
  const [commentText, setCommentText] = useState('')

  // Fetch full WO detail (includes comments and photos) when open
  const { data: woDetail, isLoading: detailLoading, refetch: refetchDetail } = useQuery({
    queryKey: ['work-order-detail', wo?.id],
    queryFn: () => engineeringApi.getWorkOrder(wo!.id),
    enabled: !!wo?.id && isOpen,
    staleTime: 10_000,
  })

  const fullWo: WorkOrder = (woDetail?.data ?? wo) as WorkOrder
  const comments: WorkOrderComment[] = fullWo?.work_order_comments ?? []
  const photos = fullWo?.work_order_photos ?? []

  // Mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    queryClient.invalidateQueries({ queryKey: ['work-order-detail', wo?.id] })
  }

  const claimMutation = useMutation({
    mutationFn: () => engineeringApi.claimWorkOrder(wo!.id),
    onSuccess: () => { invalidate(); onUpdate() },
  })

  const completeMutation = useMutation({
    mutationFn: () =>
      engineeringApi.completeWorkOrder(wo!.id, {
        notes: completionNotes.trim() || undefined,
        labor_hours: laborHours ? parseFloat(laborHours) : undefined,
        parts_used: partsUsed.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate()
      setShowCompleteForm(false)
      onUpdate()
      onClose()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (status: string) => engineeringApi.updateWorkOrder(wo!.id, { status }),
    onSuccess: () => { invalidate(); onUpdate() },
  })

  const commentMutation = useMutation({
    mutationFn: () => engineeringApi.addComment(wo!.id, commentText.trim()),
    onSuccess: () => {
      setCommentText('')
      refetchDetail()
    },
  })

  // Escape key + focus
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen && drawerRef.current) drawerRef.current.focus()
  }, [isOpen])

  // Reset form state when WO changes
  useEffect(() => {
    setShowCompleteForm(false)
    setCompletionNotes('')
    setLaborHours('')
    setPartsUsed('')
    setCommentText('')
  }, [wo?.id])

  if (!isOpen || !wo) return null

  const sla = wo.due_at ? slaDisplay(wo.due_at, wo.status) : null
  const location = wo.rooms?.room_number
    ? `Room ${wo.rooms.room_number}`
    : wo.location_text ?? null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Work Order WO-${wo.work_order_number} details`}
        className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-white shadow-2xl z-50 flex flex-col outline-none transform transition-transform duration-300 ease-in-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200 shrink-0">
          <div className="min-w-0 flex-1">
            {/* WO number + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400 shrink-0">
                WO-{wo.work_order_number}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase border ${PRIORITY_STYLES[wo.priority] ?? PRIORITY_STYLES.normal}`}
              >
                {wo.priority}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLES[wo.status] ?? 'bg-gray-100 text-gray-500'}`}
              >
                {wo.status.replace(/_/g, ' ')}
              </span>
              {wo.is_pm_generated && (
                <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-600 rounded font-medium border border-teal-200">
                  PM
                </span>
              )}
              {wo.is_ai_created && (
                <span className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded font-medium border border-violet-200">
                  AI
                </span>
              )}
            </div>

            {/* Title */}
            <h2 className="text-base font-bold text-gray-900 leading-snug pr-2">{wo.title}</h2>

            {/* Category + location */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
              <span>
                {CATEGORY_ICONS[wo.category]} {wo.category}
              </span>
              {location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {location}
                </span>
              )}
            </div>

            {/* SLA indicator */}
            {sla && (
              <div
                className={`inline-flex items-center gap-1 mt-2 text-xs font-medium ${sla.overdue ? 'text-red-600' : 'text-gray-500'}`}
              >
                <Clock className="w-3 h-3" />
                {sla.overdue ? 'SLA breached — ' : ''}
                {sla.text}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="ml-2 shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* Section: Details */}
          <div className="p-5">
            <SectionHeading>Details</SectionHeading>
            <dl className="space-y-2 text-sm">
              {wo.description && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Description</dt>
                  <dd className="text-gray-700 leading-relaxed">{wo.description}</dd>
                </div>
              )}
              {wo.assets && (
                <div className="flex items-center gap-1.5 text-gray-600">
                  <Wrench className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <span>Asset: <span className="font-medium text-gray-900">{wo.assets.name}</span></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500 pt-1">
                {wo.created_at && (
                  <div>
                    <span className="text-gray-400">Created</span>
                    <p className="text-gray-700 font-medium">{formatTs(wo.created_at)}</p>
                  </div>
                )}
                {wo.started_at && (
                  <div>
                    <span className="text-gray-400">Started</span>
                    <p className="text-gray-700 font-medium">{formatTs(wo.started_at)}</p>
                  </div>
                )}
                {wo.completed_at && (
                  <div>
                    <span className="text-gray-400">Completed</span>
                    <p className="text-gray-700 font-medium">{formatTs(wo.completed_at)}</p>
                  </div>
                )}
                {wo.labor_hours != null && (
                  <div>
                    <span className="text-gray-400">Labor hours</span>
                    <p className="text-gray-700 font-medium">{wo.labor_hours}h</p>
                  </div>
                )}
                {wo.parts_used && (
                  <div className="col-span-2">
                    <span className="text-gray-400">Parts used</span>
                    <p className="text-gray-700 font-medium">{wo.parts_used}</p>
                  </div>
                )}
                {wo.notes && (
                  <div className="col-span-2">
                    <span className="text-gray-400">Notes</span>
                    <p className="text-gray-700">{wo.notes}</p>
                  </div>
                )}
              </div>
            </dl>
          </div>

          {/* Section: Actions (role-gated) */}
          {(canClaim || canComplete || canHold || canCancel || canReopen) && (
            <div className="p-5">
              <SectionHeading>Actions</SectionHeading>
              <div className="flex flex-wrap gap-2">

                {/* Claim */}
                {canClaim && (
                  <button
                    onClick={() => claimMutation.mutate()}
                    disabled={claimMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {claimMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5" />
                    )}
                    Claim Work Order
                  </button>
                )}

                {/* Mark Complete toggle */}
                {canComplete && (
                  <button
                    onClick={() => setShowCompleteForm((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark Complete
                  </button>
                )}

                {/* Put On Hold */}
                {canHold && (
                  <button
                    onClick={() => updateMutation.mutate('on_hold')}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-60 transition-colors"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PauseCircle className="w-3.5 h-3.5" />
                    )}
                    Put On Hold
                  </button>
                )}

                {/* Reopen */}
                {canReopen && (
                  <button
                    onClick={() => updateMutation.mutate('open')}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-60 transition-colors"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Reopen
                  </button>
                )}

                {/* Cancel */}
                {canCancel && (
                  <button
                    onClick={() => updateMutation.mutate('cancelled')}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-60 transition-colors"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    Cancel
                  </button>
                )}
              </div>

              {/* Inline completion form */}
              {showCompleteForm && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-green-800">Complete Work Order</p>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Notes <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      rows={3}
                      placeholder="What was done, findings, etc."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Labor hours <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={laborHours}
                        onChange={(e) => setLaborHours(e.target.value)}
                        placeholder="e.g. 1.5"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Parts used <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={partsUsed}
                        onChange={(e) => setPartsUsed(e.target.value)}
                        placeholder="e.g. Filter, belt"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  </div>

                  {completeMutation.isError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      Failed to complete work order. Please try again.
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => completeMutation.mutate()}
                      disabled={completeMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                    >
                      {completeMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      Submit Completion
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCompleteForm(false)}
                      className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section: Photos */}
          {photos.length > 0 && (
            <div className="p-5">
              <SectionHeading>Photos</SectionHeading>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Image className="w-4 h-4 text-gray-400" />
                <span>{photos.length} photo{photos.length !== 1 ? 's' : ''} attached</span>
                <span className="text-xs text-gray-400">
                  ({photos.filter((p) => p.photo_type === 'before').length} before,{' '}
                  {photos.filter((p) => p.photo_type === 'after').length} after)
                </span>
              </div>
            </div>
          )}

          {/* Section: Comments */}
          <div className="p-5">
            <SectionHeading>Comments</SectionHeading>

            {detailLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-gray-200 mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 bg-gray-200 rounded w-20" />
                      <div className="h-3 bg-gray-200 rounded w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">No comments yet.</p>
            ) : (
              <div className="relative mb-4">
                {/* Timeline line */}
                <div className="absolute left-1 top-2 bottom-2 w-px bg-gray-200" />
                <div className="space-y-4">
                  {comments.map((c, i) => (
                    <div key={c.id} className="flex items-start gap-3 pl-1">
                      <div
                        className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 border-2 border-white ${
                          c.is_system ? 'bg-violet-400' : i === 0 ? 'bg-gray-700' : 'bg-gray-300'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatTs(c.created_at) ?? '—'}
                          </span>
                          {c.is_system && (
                            <span className="text-xs text-violet-600 font-medium">System</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5 leading-snug">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add comment form */}
            <div className="space-y-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
                placeholder="Add a comment…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              <button
                onClick={() => {
                  if (commentText.trim()) commentMutation.mutate()
                }}
                disabled={!commentText.trim() || commentMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-900 disabled:opacity-50 transition-colors"
              >
                {commentMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5" />
                )}
                Add Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
