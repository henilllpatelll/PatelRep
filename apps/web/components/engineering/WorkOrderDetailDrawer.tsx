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
  Pencil,
  ClipboardList,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { engineeringApi, WorkOrder, WorkOrderComment } from '@/lib/api/engineering'
import { tasksApi } from '@/lib/api/tasks'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'

interface Props {
  wo: WorkOrder | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  startInEditMode?: boolean
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
  urgent: 'bg-red-50 text-red-700 border border-red-200',
  normal: 'bg-blue-50 text-blue-700 border border-blue-200',
  low: 'bg-slate-50 text-slate-600 border border-slate-200',
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
  if (h >= 24) {
    const d = Math.floor(h / 24)
    text = `${d} ${d === 1 ? 'day' : 'days'} ${suffix}`
  } else if (h > 0) {
    text = `${h}h ${m}m ${suffix}`
  } else {
    text = `${m}m ${suffix}`
  }
  return { text, overdue }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
      {children}
    </h3>
  )
}

export function WorkOrderDetailDrawer({ wo, isOpen, onClose, onUpdate, startInEditMode }: Props) {
  const { role, isGM } = useRole()
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)

  const isEngineer = role === 'engineer'
  const isChief = role === 'chief_engineer'

  // Completion form state
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [partsUsed, setPartsUsed] = useState('')

  // Comment state
  const [commentText, setCommentText] = useState('')

  // Push to Housekeeping state
  const [hkTaskNote, setHkTaskNote] = useState('')
  const [hkTaskPriority, setHkTaskPriority] = useState<'urgent' | 'normal' | 'low'>('normal')
  const [hkTaskSuccess, setHkTaskSuccess] = useState(false)

  // Edit mode
  const [isEditing, setIsEditing] = useState(startInEditMode ?? false)
  const [editForm, setEditForm] = useState({
    title: wo?.title ?? '',
    description: wo?.description ?? '',
    category: wo?.category ?? 'general',
    priority: wo?.priority ?? 'normal',
    notes: wo?.notes ?? '',
  })

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

  const canClaim = (isEngineer || isChief || isGM) && fullWo?.status === 'open'
  const canComplete = (isEngineer || isChief || isGM) && fullWo?.status === 'in_progress'
  const canHold = (isChief || isGM) && fullWo?.status === 'in_progress'
  const canCancel = (isChief || isGM) && (fullWo?.status === 'open' || fullWo?.status === 'on_hold')
  const canReopen = (isChief || isGM) && fullWo?.status === 'on_hold'

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

  const hkTaskMutation = useMutation({
    mutationFn: () =>
      tasksApi.create({
        title: hkTaskNote.trim() || `Housekeeping needed — Room ${fullWo.rooms?.room_number}`,
        description: `From WO-${fullWo.work_order_number}: ${hkTaskNote.trim()}`,
        task_type: 'housekeeping',
        priority: hkTaskPriority,
        room_id: fullWo.room_id,
      }),
    onSuccess: () => {
      setHkTaskNote('')
      setHkTaskSuccess(true)
    },
  })

  const editMutation = useMutation({
    mutationFn: () => engineeringApi.updateWorkOrder(wo!.id, {
      title: editForm.title || undefined,
      description: editForm.description || undefined,
      category: editForm.category,
      priority: editForm.priority,
      notes: editForm.notes || undefined,
    }),
    onSuccess: () => { setIsEditing(false); invalidate() },
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
    setHkTaskNote('')
    setHkTaskPriority('normal')
    setHkTaskSuccess(false)
    setIsEditing(startInEditMode ?? false)
    setEditForm({
      title: wo?.title ?? '',
      description: wo?.description ?? '',
      category: wo?.category ?? 'general',
      priority: wo?.priority ?? 'normal',
      notes: wo?.notes ?? '',
    })
  }, [wo?.id, startInEditMode])

  if (!isOpen || !wo) return null

  const sla = fullWo.due_at ? slaDisplay(fullWo.due_at, fullWo.status) : null
  const location = fullWo.rooms?.room_number
    ? `Room ${fullWo.rooms.room_number}`
    : fullWo.location_text ?? null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Work Order WO-${fullWo.work_order_number} details`}
        className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-white/[0.88] backdrop-blur-2xl border-l border-white/[0.95] z-50 flex flex-col outline-none transform transition-transform duration-300 ease-in-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between p-5 border-b border-white/60 shrink-0">
          <div className="min-w-0 flex-1">
            {/* WO number + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400 shrink-0">
                WO-{fullWo.work_order_number}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase border ${PRIORITY_STYLES[fullWo.priority] ?? PRIORITY_STYLES.normal}`}
              >
                {fullWo.priority}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLES[fullWo.status] ?? 'bg-gray-100 text-gray-500'}`}
              >
                {fullWo.status.replace(/_/g, ' ')}
              </span>
              {fullWo.is_pm_generated && (
                <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-600 rounded font-medium border border-teal-200">
                  PM
                </span>
              )}
              {fullWo.is_ai_created && (
                <span className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded font-medium border border-violet-200">
                  AI
                </span>
              )}
            </div>

            {/* Title */}
            <h2 className="text-base font-bold text-gray-900 leading-snug pr-2">{fullWo.title}</h2>

            {/* Category + location */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
              <span>
                {CATEGORY_ICONS[fullWo.category]} {fullWo.category}
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

          <div className="flex items-center gap-1 ml-2 shrink-0">
            {(isChief || isGM) && (
              <button
                onClick={() => setIsEditing((v) => !v)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Edit work order"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/60">

          {/* Section: Inline edit — chief/GM only */}
          {isEditing && (isChief || isGM) && (
            <div className="p-5 bg-amber-50/60 border-b border-amber-200/40">
              <p className="text-xs font-semibold text-amber-800 mb-3">Edit Work Order</p>
              <div className="space-y-3">
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Title"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Description (optional)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value as WorkOrder['category'] }))}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    {['plumbing','electrical','hvac','furniture','appliance','structural','safety','general'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as WorkOrder['priority'] }))}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Notes (optional)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => editMutation.mutate()}
                    disabled={editMutation.isPending || !editForm.title.trim()}
                    className="flex-1 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {editMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section: Details */}
          <div className="p-5">
            <SectionHeading>Details</SectionHeading>
            <dl className="space-y-2 text-sm">
              {fullWo.description && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Description</dt>
                  <dd className="text-gray-700 leading-relaxed">{fullWo.description}</dd>
                </div>
              )}
              {fullWo.assets && (
                <div className="flex items-center gap-1.5 text-gray-600">
                  <Wrench className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <span>Asset: <span className="font-medium text-gray-900">{fullWo.assets.name}</span></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500 pt-1">
                {fullWo.created_at && (
                  <div>
                    <span className="text-gray-400">Created</span>
                    <p className="text-gray-700 font-medium">{formatTs(fullWo.created_at)}</p>
                  </div>
                )}
                {fullWo.started_at && (
                  <div>
                    <span className="text-gray-400">Started</span>
                    <p className="text-gray-700 font-medium">{formatTs(fullWo.started_at)}</p>
                  </div>
                )}
                {fullWo.completed_at && (
                  <div>
                    <span className="text-gray-400">Completed</span>
                    <p className="text-gray-700 font-medium">{formatTs(fullWo.completed_at)}</p>
                  </div>
                )}
                {fullWo.labor_hours != null && (
                  <div>
                    <span className="text-gray-400">Labor hours</span>
                    <p className="text-gray-700 font-medium">{fullWo.labor_hours}h</p>
                  </div>
                )}
                {fullWo.parts_used && (
                  <div className="col-span-2">
                    <span className="text-gray-400">Parts used</span>
                    <p className="text-gray-700 font-medium">{fullWo.parts_used}</p>
                  </div>
                )}
                {fullWo.notes && (
                  <div className="col-span-2">
                    <span className="text-gray-400">Notes</span>
                    <p className="text-gray-700">{fullWo.notes}</p>
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
                  <Button
                    variant="primary"
                    onClick={() => claimMutation.mutate()}
                    disabled={claimMutation.isPending}
                  >
                    {claimMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5" />
                    )}
                    Claim Work Order
                  </Button>
                )}

                {/* Mark Complete toggle */}
                {canComplete && (
                  <Button
                    variant="secondary"
                    onClick={() => setShowCompleteForm((v) => !v)}
                    className="border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark Complete
                  </Button>
                )}

                {/* Put On Hold */}
                {canHold && (
                  <Button
                    variant="ghost"
                    onClick={() => updateMutation.mutate('on_hold')}
                    disabled={updateMutation.isPending}
                    className="text-orange-700 border-orange-200 hover:bg-orange-50"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PauseCircle className="w-3.5 h-3.5" />
                    )}
                    Put On Hold
                  </Button>
                )}

                {/* Reopen */}
                {canReopen && (
                  <Button
                    variant="ghost"
                    onClick={() => updateMutation.mutate('open')}
                    disabled={updateMutation.isPending}
                    className="text-blue-700 border-blue-200 hover:bg-blue-50"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Reopen
                  </Button>
                )}

                {/* Cancel */}
                {canCancel && (
                  <Button
                    variant="destructive"
                    onClick={() => updateMutation.mutate('cancelled')}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    Cancel
                  </Button>
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
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none bg-white/70 backdrop-blur-sm"
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
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white/70 backdrop-blur-sm"
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
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white/70 backdrop-blur-sm"
                      />
                    </div>
                  </div>

                  {completeMutation.isError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      Failed to complete work order. Please try again.
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => completeMutation.mutate()}
                      disabled={completeMutation.isPending}
                      className="border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                    >
                      {completeMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      Submit Completion
                    </Button>
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

          {/* Section: Push to Housekeeping */}
          {fullWo.room_id && (isEngineer || isChief || isGM) && (
            <div className="p-5">
              <SectionHeading>Push to Housekeeping</SectionHeading>
              {hkTaskSuccess ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Task pushed to housekeeping.
                  <button
                    type="button"
                    onClick={() => setHkTaskSuccess(false)}
                    className="ml-auto text-green-600 hover:text-green-800"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Create a housekeeping task for{' '}
                    <span className="font-medium text-gray-700">
                      Room {fullWo.rooms?.room_number}
                    </span>.
                  </p>
                  <textarea
                    value={hkTaskNote}
                    onChange={(e) => setHkTaskNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Deep clean needed — repair complete, debris in bathroom"
                    className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white/70 backdrop-blur-sm resize-none transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={hkTaskPriority}
                      onChange={(e) => setHkTaskPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    >
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                      <option value="low">Low</option>
                    </select>
                    <Button
                      variant="ghost"
                      onClick={() => { if (hkTaskNote.trim()) hkTaskMutation.mutate() }}
                      disabled={!hkTaskNote.trim() || hkTaskMutation.isPending}
                      className="text-teal-700 border-teal-200 hover:bg-teal-50"
                    >
                      {hkTaskMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ClipboardList className="w-3.5 h-3.5" />
                      )}
                      Push to Housekeeping
                    </Button>
                  </div>
                  {hkTaskMutation.isError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      Failed to create task. Please try again.
                    </p>
                  )}
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
                className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 bg-white/70 backdrop-blur-sm resize-none transition-colors"
              />
              <Button
                variant="ghost"
                onClick={() => {
                  if (commentText.trim()) commentMutation.mutate()
                }}
                disabled={!commentText.trim() || commentMutation.isPending}
                className="text-slate-700"
              >
                {commentMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5" />
                )}
                Add Comment
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
