'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Clock,
  MapPin,
  Wrench,
  MessageSquare,
  Image as ImageIcon,
  Loader2,
  CheckCircle,
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
import { Pill, AILabel, SectionLabel } from '@/components/ui/primitives'

interface Props {
  wo: WorkOrder | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  startInEditMode?: boolean
}

const CATEGORY_ICONS: Record<string, string> = {
  plumbing:   '💧',
  electrical: '⚡',
  hvac:       '❄️',
  furniture:  '🪑',
  appliance:  '🔌',
  structural: '🏗️',
  safety:     '🛡️',
  general:    '🔧',
}

const STATUS_TONE: Record<string, 'info' | 'caution' | 'alert' | 'ready' | 'neutral'> = {
  open:       'info',
  in_progress:'caution',
  on_hold:    'alert',
  completed:  'ready',
  cancelled:  'neutral',
}

const PRIORITY_TONE: Record<string, 'alert' | 'caution' | 'ready'> = {
  urgent: 'alert',
  normal: 'caution',
  low:    'ready',
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

  const canClaim   = (isEngineer || isChief || isGM) && fullWo?.status === 'open'
  const canComplete = (isEngineer || isChief || isGM) && fullWo?.status === 'in_progress'
  const canHold    = (isChief || isGM) && fullWo?.status === 'in_progress'
  const canCancel  = (isChief || isGM) && (fullWo?.status === 'open' || fullWo?.status === 'on_hold')
  const canReopen  = (isChief || isGM) && fullWo?.status === 'on_hold'

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
      setShowCompleteForm(false)
      setCompletionNotes('')
      setLaborHours('')
      setPartsUsed('')
      invalidate()
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
    mutationFn: () =>
      engineeringApi.updateWorkOrder(wo!.id, {
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

  // Reset form state when WO changes or drawer closes
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
  }, [
    isOpen,
    startInEditMode,
    wo?.category,
    wo?.description,
    wo?.id,
    wo?.notes,
    wo?.priority,
    wo?.title,
  ])

  if (!isOpen || !wo) return null

  const sla = fullWo.due_at ? slaDisplay(fullWo.due_at, fullWo.status) : null
  const location = fullWo.rooms?.room_number
    ? `Room ${fullWo.rooms.room_number}`
    : fullWo.location_text ?? null

  // AI insight: show if ai_created with description or notes resembling insight text
  const aiInsightText = fullWo.is_ai_created ? (fullWo.description ?? fullWo.notes ?? null) : null

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
        className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-surface/[0.88] backdrop-blur-2xl border-l border-white/[0.95] z-50 flex flex-col outline-none"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 300ms ease-in-out' }}
      >
        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-10 bg-surface/90 backdrop-blur-sm px-5 pt-5 pb-4 border-b border-line shrink-0">
          {/* WO number row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-ink3">
                  WO-{fullWo.work_order_number}
                </span>
                <Pill tone={STATUS_TONE[fullWo.status] ?? 'neutral'} size="sm">
                  {fullWo.status.replace(/_/g, ' ')}
                </Pill>
                <Pill tone={PRIORITY_TONE[fullWo.priority] ?? 'caution'} size="sm">
                  {fullWo.priority}
                </Pill>
                {fullWo.is_pm_generated && (
                  <Pill tone="ready" size="sm">PM</Pill>
                )}
                {fullWo.is_ai_created && (
                  <AILabel>AI</AILabel>
                )}
              </div>

              {/* Title */}
              <h2 className="text-[16px] font-semibold text-ink leading-snug pr-2">
                {fullWo.title}
              </h2>

              {/* Category + location */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px] text-ink3">
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
                  className={`inline-flex items-center gap-1 mt-2 text-[11px] font-medium font-mono ${sla.overdue ? 'text-[var(--alert)]' : 'text-ink3'}`}
                >
                  <Clock className="w-3 h-3" />
                  {sla.overdue ? 'SLA breached — ' : ''}
                  {sla.text}
                </div>
              )}
            </div>

            {/* Edit + close */}
            <div className="flex items-center gap-1 shrink-0">
              {(isChief || isGM) && (
                <button
                  onClick={() => setIsEditing((v) => !v)}
                  className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-surface-3 transition-colors"
                  aria-label="Edit work order"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-surface-3 transition-colors"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* AI insight callout */}
          {aiInsightText && (
            <div className="bg-[var(--ai-soft)] border border-[var(--ai-line)] rounded-[var(--r-md)] p-3.5 mt-3">
              <AILabel confidence={undefined}>AI Analysis</AILabel>
              <p className="font-display italic text-[13px] leading-[1.45] text-ink mt-2">
                {aiInsightText}
              </p>
            </div>
          )}
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto divide-y divide-line">

          {/* Inline edit — chief/GM only */}
          {isEditing && (isChief || isGM) && (
            <div className="p-5 bg-[var(--caution-soft)]/60 border-b border-[var(--caution-line)]/40">
              <p className="text-xs font-semibold text-[var(--caution)] mb-3">Edit Work Order</p>
              <div className="space-y-3">
                <input
                  aria-label="Work order title"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Title"
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface"
                />
                <textarea
                  aria-label="Work order description"
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Description (optional)"
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none bg-surface"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Work order category"
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value as WorkOrder['category'] }))}
                    className="text-sm border border-line rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    {['plumbing','electrical','hvac','furniture','appliance','structural','safety','general'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Work order priority"
                    value={editForm.priority}
                    onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as WorkOrder['priority'] }))}
                    className="text-sm border border-line rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <textarea
                  aria-label="Work order notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Notes (optional)"
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none bg-surface"
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => editMutation.mutate()}
                    disabled={editMutation.isPending || !editForm.title.trim()}
                    className="flex-1"
                  >
                    {editMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                    Save
                  </Button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-sm text-ink2 border border-line rounded-lg hover:bg-surface-3 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section: Details */}
          <div className="p-5">
            <SectionLabel>Details</SectionLabel>
            <dl className="space-y-2 text-sm">
              {fullWo.description && (
                <div>
                  <dt className="font-mono text-[11px] text-ink3 mb-0.5">Description</dt>
                  <dd className="text-ink2 leading-relaxed">{fullWo.description}</dd>
                </div>
              )}
              {fullWo.assets && (
                <div className="flex items-center gap-1.5 text-ink2">
                  <Wrench className="w-3.5 h-3.5 shrink-0 text-ink3" />
                  <span>Asset: <span className="font-medium text-ink">{fullWo.assets.name}</span></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
                {fullWo.created_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">Created</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.created_at)}</p>
                  </div>
                )}
                {fullWo.started_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">Started</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.started_at)}</p>
                  </div>
                )}
                {fullWo.completed_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">Completed</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.completed_at)}</p>
                  </div>
                )}
                {fullWo.labor_hours != null && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">Labor hours</span>
                    <p className="text-[13px] text-ink font-medium">{fullWo.labor_hours}h</p>
                  </div>
                )}
                {fullWo.parts_used && (
                  <div className="col-span-2">
                    <span className="font-mono text-[11px] text-ink3">Parts used</span>
                    <p className="text-[13px] text-ink font-medium">{fullWo.parts_used}</p>
                  </div>
                )}
                {fullWo.notes && (
                  <div className="col-span-2">
                    <span className="font-mono text-[11px] text-ink3">Notes</span>
                    <p className="text-[13px] text-ink2">{fullWo.notes}</p>
                  </div>
                )}
              </div>
            </dl>
          </div>

          {/* Section: Actions (role-gated) */}
          {(canClaim || canComplete || canHold || canCancel || canReopen) && (
            <div className="p-5">
              <SectionLabel>Actions</SectionLabel>
              <div className="flex flex-wrap gap-2">

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

                {canComplete && (
                  <Button
                    variant="secondary"
                    onClick={() => setShowCompleteForm((v) => !v)}
                    className="border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Mark Complete
                  </Button>
                )}

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

                {canReopen && (
                  <Button
                    variant="ghost"
                    onClick={() => updateMutation.mutate('open')}
                    disabled={updateMutation.isPending}
                    className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Reopen
                  </Button>
                )}

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
                <div className="mt-4 p-4 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-[var(--ready)]">Complete Work Order</p>

                  <div>
                    <label className="block font-mono text-[11px] text-ink3 mb-1">
                      Notes <span className="font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      rows={3}
                      placeholder="What was done, findings, etc."
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] resize-none bg-surface/70 backdrop-blur-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[11px] text-ink3 mb-1">
                        Labor hours <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={laborHours}
                        onChange={(e) => setLaborHours(e.target.value)}
                        placeholder="e.g. 1.5"
                        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] bg-surface/70 backdrop-blur-sm"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-ink3 mb-1">
                        Parts used <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={partsUsed}
                        onChange={(e) => setPartsUsed(e.target.value)}
                        placeholder="e.g. Filter, belt"
                        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] bg-surface/70 backdrop-blur-sm"
                      />
                    </div>
                  </div>

                  {completeMutation.isError && (
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                      Failed to complete work order. Please try again.
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => completeMutation.mutate()}
                      disabled={completeMutation.isPending}
                      className="border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
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
                      className="px-3 py-2 text-sm text-ink2 hover:text-ink transition-colors"
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
              <SectionLabel>Push to Housekeeping</SectionLabel>
              {hkTaskSuccess ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ready)] bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Task pushed to housekeeping.
                  <button
                    type="button"
                    onClick={() => setHkTaskSuccess(false)}
                    className="ml-auto text-[var(--ready)] hover:text-[var(--ready)]"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[12px] text-ink3">
                    Create a housekeeping task for{' '}
                    <span className="font-medium text-ink">
                      Room {fullWo.rooms?.room_number}
                    </span>.
                  </p>
                  <textarea
                    aria-label="Message to housekeeping team"
                    value={hkTaskNote}
                    onChange={(e) => setHkTaskNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Deep clean needed — repair complete, debris in bathroom"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface/70 backdrop-blur-sm resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <label htmlFor="hk-push-priority" className="sr-only">Priority</label>
                    <select
                      id="hk-push-priority"
                      value={hkTaskPriority}
                      onChange={(e) => setHkTaskPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                      className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
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
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
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
              <SectionLabel>Photos</SectionLabel>
              <div className="flex items-center gap-2 text-sm text-ink2">
                <ImageIcon className="w-4 h-4 text-ink3" />
                <span>{photos.length} photo{photos.length !== 1 ? 's' : ''} attached</span>
                <span className="font-mono text-[11px] text-ink3">
                  ({photos.filter((p) => p.photo_type === 'before').length} before,{' '}
                  {photos.filter((p) => p.photo_type === 'after').length} after)
                </span>
              </div>
            </div>
          )}

          {/* Section: Timeline / Comments */}
          <div className="p-5">
            <SectionLabel>Timeline</SectionLabel>

            {detailLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-surface-3 mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 bg-surface-3 rounded w-20" />
                      <div className="h-3 bg-surface-3 rounded w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-ink3 mb-4">No activity yet.</p>
            ) : (
              <div className="relative mb-4">
                {/* Timeline line */}
                <div className="absolute left-1 top-2 bottom-2 w-px bg-line" />
                <div className="space-y-4">
                  {comments.map((c, i) => (
                    <div key={c.id} className="flex items-start gap-3 pl-1">
                      <div
                        className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 border-2 border-surface ${
                          c.is_system ? 'bg-[var(--ai)]' : i === 0 ? 'bg-ink' : 'bg-ink3'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] text-ink3 shrink-0">
                            {formatTs(c.created_at) ?? '—'}
                          </span>
                          {c.is_system && (
                            <span className="text-[11px] text-[var(--ai)] font-medium">System</span>
                          )}
                        </div>
                        <p className="text-[13px] text-ink2 mt-0.5 leading-snug">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add comment form */}
            <div className="space-y-2">
              <textarea
                aria-label="Add comment"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
                placeholder="Add a comment…"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] bg-surface/70 backdrop-blur-sm resize-none transition-colors"
              />
              <Button
                variant="ghost"
                onClick={() => { if (commentText.trim()) commentMutation.mutate() }}
                disabled={!commentText.trim() || commentMutation.isPending}
                className="text-ink2"
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

        {/* ── Sticky action bar ── */}
        {(canClaim || canComplete || canHold || canCancel || canReopen) && (
          <div className="sticky bottom-0 shrink-0 bg-surface/90 backdrop-blur-sm border-t border-line px-5 py-3 flex items-center gap-2">
            {canClaim && (
              <Button
                variant="primary"
                onClick={() => claimMutation.mutate()}
                disabled={claimMutation.isPending}
                className="flex-1 bg-accent text-white hover:bg-[#a23a18]"
              >
                {claimMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wrench className="w-3.5 h-3.5" />
                )}
                Claim
              </Button>
            )}
            {canComplete && (
              <Button
                variant="secondary"
                onClick={() => setShowCompleteForm((v) => !v)}
                className="flex-1 border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Complete
              </Button>
            )}
            {canCancel && (
              <Button
                variant="ghost"
                onClick={() => updateMutation.mutate('cancelled')}
                disabled={updateMutation.isPending}
                className="text-ink3 border-line hover:text-[var(--alert)] hover:border-[var(--alert-line)] hover:bg-[var(--alert-soft)]"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                Cancel
              </Button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm text-ink3 hover:text-ink border border-line rounded-lg hover:bg-surface-3 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </>
  )
}
