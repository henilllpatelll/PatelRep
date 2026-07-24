'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Clock,
  MapPin,
  Wrench,
  MessageSquare,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  CheckCircle,
  PauseCircle,
  XCircle,
  RotateCcw,
  Pencil,
  ClipboardList,
  AlertCircle,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import {
  engineeringApi,
  type TransitionWorkOrderPayload,
  type WorkOrder,
  type WorkOrderComment,
  type WorkOrderStatus,
} from '@/lib/api/engineering'
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
  escalated:  'alert',
  in_progress:'caution',
  on_hold:    'alert',
  completed:  'ready',
  cancelled:  'neutral',
}

const PRIORITY_TONE: Record<string, 'alert' | 'caution' | 'ready'> = {
  emergency: 'alert',
  urgent: 'alert',
  normal: 'caution',
  low:    'ready',
}

function formatTs(iso: string | undefined | null, t: TFunction): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const time = format(d, 'h:mm a')
    if (isToday(d)) return t('engineering.workOrderDetail.todayTime', { time })
    if (isYesterday(d)) return t('engineering.workOrderDetail.yesterdayTime', { time })
    return `${format(d, 'MMM d')} ${time}`
  } catch {
    return iso
  }
}

function slaDisplay(dueAt: string, status: string, t: TFunction): { text: string; overdue: boolean } | null {
  if (status === 'completed' || status === 'cancelled') return null
  const diff = new Date(dueAt).getTime() - Date.now()
  const overdue = diff < 0
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const suffix = overdue ? t('engineering.workOrderCard.overdue') : t('engineering.workOrderCard.left')
  let text: string
  if (h >= 24) {
    const d = Math.floor(h / 24)
    const dayLabel = d === 1 ? t('engineering.workOrderCard.day') : t('engineering.workOrderCard.days')
    text = `${d} ${dayLabel} ${suffix}`
  } else if (h > 0) {
    text = `${h}h ${m}m ${suffix}`
  } else {
    text = `${m}m ${suffix}`
  }
  return { text, overdue }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function getPhotoUrl(storagePath: string, photoUrl?: string): string {
  if (photoUrl) return photoUrl
  return `${SUPABASE_URL}/storage/v1/object/public/work-order-photos/${storagePath}`
}

export function WorkOrderDetailDrawer({ wo, isOpen, onClose, onUpdate, startInEditMode }: Props) {
  const { t } = useTranslation()
  const { role, isGM } = useRole()
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const isEngineer = role === 'engineer'
  const isChief = role === 'engineer'

  // Completion form state
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [partsUsed, setPartsUsed] = useState('')
  const [pendingTransition, setPendingTransition] = useState<WorkOrderStatus | null>(null)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitionNote, setTransitionNote] = useState('')

  // Comment state
  const [commentText, setCommentText] = useState('')

  // Photo upload state
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoType, setPhotoType] = useState<'before' | 'after' | 'progress'>('progress')
  const [photoError, setPhotoError] = useState<string | null>(null)

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
  const canResume = (isChief || isGM) && fullWo?.status === 'on_hold'
  const canReopen = (isChief || isGM) && (fullWo?.status === 'completed' || fullWo?.status === 'cancelled')
  const canEscalate = (isEngineer || isChief || isGM) && !!fullWo && !['escalated', 'completed', 'cancelled'].includes(fullWo.status)

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

  const transitionMutation = useMutation({
    mutationFn: (payload: TransitionWorkOrderPayload) =>
      engineeringApi.transitionWorkOrder(wo!.id, payload),
    onSuccess: () => {
      setPendingTransition(null)
      setTransitionReason('')
      setTransitionNote('')
      invalidate()
      onUpdate()
    },
  })

  const openTransitionDialog = (status: WorkOrderStatus) => {
    setPendingTransition(status)
    setTransitionReason('')
    setTransitionNote('')
  }

  const submitTransition = () => {
    if (!pendingTransition || !transitionReason) return
    transitionMutation.mutate({
      status: pendingTransition,
      reason_code: transitionReason as TransitionWorkOrderPayload['reason_code'],
      reason_note: transitionNote.trim() || undefined,
      source: 'web',
    })
  }

  const commentMutation = useMutation({
    mutationFn: () => engineeringApi.addComment(wo!.id, commentText.trim()),
    onSuccess: () => {
      setCommentText('')
      refetchDetail()
    },
  })

  const uploadPhotoMutation = useMutation({
    mutationFn: () => engineeringApi.uploadWorkOrderPhoto(wo!.id, photoFile!, photoType),
    onSuccess: () => {
      setPhotoFile(null)
      setPhotoPreview(null)
      setPhotoType('progress')
      setPhotoError(null)
      refetchDetail()
    },
    onError: () => setPhotoError(t('engineering.workOrderDetail.uploadError')),
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
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoType('progress')
    setPhotoError(null)
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

  const sla = fullWo.due_at ? slaDisplay(fullWo.due_at, fullWo.status, t) : null
  const location = fullWo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${fullWo.rooms.room_number}`
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
        aria-label={t('engineering.workOrderDetail.ariaLabel', { number: fullWo.work_order_number })}
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
                  <Pill tone="ready" size="sm">{t('engineering.workOrderCard.pm')}</Pill>
                )}
                {fullWo.is_ai_created && (
                  <AILabel>{t('engineering.workOrderDetail.ai')}</AILabel>
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
                  {sla.overdue ? t('engineering.workOrderDetail.slaBreachedPrefix') : ''}
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
                  aria-label={t('engineering.workOrderDetail.editWorkOrder')}
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-surface-3 transition-colors"
                aria-label={t('engineering.workOrderDetail.closeDrawer')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* AI insight callout */}
          {aiInsightText && (
            <div className="bg-[var(--ai-soft)] border border-[var(--ai-line)] rounded-[var(--r-md)] p-3.5 mt-3">
              <AILabel confidence={undefined}>{t('engineering.workOrderDetail.aiAnalysis')}</AILabel>
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
              <p className="text-xs font-semibold text-[var(--caution)] mb-3">{t('engineering.workOrderDetail.editHeading')}</p>
              <div className="space-y-3">
                <input
                  aria-label={t('engineering.workOrderDetail.titleAriaLabel')}
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={t('engineering.workOrderDetail.titlePlaceholder')}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface"
                />
                <textarea
                  aria-label={t('engineering.workOrderDetail.descriptionAriaLabel')}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder={t('engineering.workOrderDetail.descriptionPlaceholder')}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none bg-surface"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label={t('engineering.workOrderDetail.categoryAriaLabel')}
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value as WorkOrder['category'] }))}
                    className="text-sm border border-line rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    {['plumbing','electrical','hvac','furniture','appliance','structural','safety','general'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    aria-label={t('engineering.workOrderDetail.priorityAriaLabel')}
                    value={editForm.priority}
                    onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as WorkOrder['priority'] }))}
                    className="text-sm border border-line rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  >
                    <option value="urgent">{t('engineering.workOrderDetail.priorityUrgent')}</option>
                    <option value="normal">{t('engineering.workOrderDetail.priorityNormal')}</option>
                    <option value="low">{t('engineering.workOrderDetail.priorityLow')}</option>
                  </select>
                </div>
                <textarea
                  aria-label={t('engineering.workOrderDetail.notesAriaLabel')}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder={t('engineering.workOrderDetail.notesEditPlaceholder')}
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
                    {t('engineering.workOrderDetail.save')}
                  </Button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-sm text-ink2 border border-line rounded-lg hover:bg-surface-3 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section: Details */}
          <div className="p-5">
            <SectionLabel>{t('engineering.workOrderDetail.details')}</SectionLabel>
            <dl className="space-y-2 text-sm">
              {fullWo.description && (
                <div>
                  <dt className="font-mono text-[11px] text-ink3 mb-0.5">{t('engineering.workOrderDetail.descriptionLabel')}</dt>
                  <dd className="text-ink2 leading-relaxed">{fullWo.description}</dd>
                </div>
              )}
              {fullWo.assets && (
                <div className="flex items-center gap-1.5 text-ink2">
                  <Wrench className="w-3.5 h-3.5 shrink-0 text-ink3" />
                  <span>{t('engineering.workOrderDetail.assetLabel')} <span className="font-medium text-ink">{fullWo.assets.name}</span></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
                {fullWo.created_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">{t('engineering.workOrderDetail.createdLabel')}</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.created_at, t)}</p>
                  </div>
                )}
                {fullWo.started_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">{t('engineering.workOrderDetail.startedLabel')}</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.started_at, t)}</p>
                  </div>
                )}
                {fullWo.completed_at && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">{t('engineering.workOrderDetail.completedLabel')}</span>
                    <p className="text-[13px] text-ink font-medium">{formatTs(fullWo.completed_at, t)}</p>
                  </div>
                )}
                {fullWo.labor_hours != null && (
                  <div>
                    <span className="font-mono text-[11px] text-ink3">{t('engineering.workOrderDetail.laborHoursLabel')}</span>
                    <p className="text-[13px] text-ink font-medium">{`${fullWo.labor_hours}h`}</p>
                  </div>
                )}
                {fullWo.parts_used && (
                  <div className="col-span-2">
                    <span className="font-mono text-[11px] text-ink3">{t('programs.pmCompletion.partsUsed')}</span>
                    <p className="text-[13px] text-ink font-medium">{fullWo.parts_used}</p>
                  </div>
                )}
                {fullWo.notes && (
                  <div className="col-span-2">
                    <span className="font-mono text-[11px] text-ink3">{t('programs.pmCompletion.notesLabel')}</span>
                    <p className="text-[13px] text-ink2">{fullWo.notes}</p>
                  </div>
                )}
              </div>
            </dl>
          </div>

          {/* Section: Actions (role-gated) */}
          {(canClaim || canComplete || canHold || canCancel || canResume || canReopen || canEscalate) && (
            <div className="p-5">
              <SectionLabel>{t('engineering.workOrderDetail.sectionActions')}</SectionLabel>
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
                    {t('engineering.workOrderDetail.claimWorkOrder')}
                  </Button>
                )}

                {canComplete && (
                  <Button
                    variant="secondary"
                    onClick={() => setShowCompleteForm((v) => !v)}
                    className="border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t('engineering.workOrderDetail.markComplete')}
                  </Button>
                )}

                {canHold && (
                  <Button
                    variant="ghost"
                    onClick={() => openTransitionDialog('on_hold')}
                    disabled={transitionMutation.isPending}
                    className="text-orange-700 border-orange-200 hover:bg-orange-50"
                  >
                    {transitionMutation.isPending && pendingTransition === 'on_hold' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <PauseCircle className="w-3.5 h-3.5" />
                    )}
                    {t('engineering.workOrderDetail.putOnHold')}
                  </Button>
                )}

                {canResume && (
                  <Button
                    variant="ghost"
                    onClick={() => transitionMutation.mutate({ status: 'in_progress', source: 'web' })}
                    disabled={transitionMutation.isPending}
                    className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('engineering.workOrderDetail.resume')}
                  </Button>
                )}

                {canReopen && (
                  <Button
                    variant="ghost"
                    onClick={() => openTransitionDialog('open')}
                    disabled={transitionMutation.isPending}
                    className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]"
                  >
                    {transitionMutation.isPending && pendingTransition === 'open' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    {t('engineering.workOrderDetail.reopen')}
                  </Button>
                )}

                {canCancel && (
                  <Button
                    variant="destructive"
                    onClick={() => openTransitionDialog('cancelled')}
                    disabled={transitionMutation.isPending}
                  >
                    {transitionMutation.isPending && pendingTransition === 'cancelled' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {t('common.cancel')}
                  </Button>
                )}

                {canEscalate && (
                  <Button
                    variant="ghost"
                    onClick={() => transitionMutation.mutate({ status: 'escalated', source: 'web' })}
                    disabled={transitionMutation.isPending}
                    className="text-[var(--alert)] border-[var(--alert-line)] hover:bg-[var(--alert-soft)]"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    {t('engineering.workOrderDetail.escalate')}
                  </Button>
                )}
              </div>

              {pendingTransition && (
                <div className="mt-4 p-4 bg-surface-2 border border-line rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-ink">
                    {pendingTransition === 'on_hold' ? t('engineering.workOrderDetail.reasonOnHold') : pendingTransition === 'cancelled' ? t('engineering.workOrderDetail.reasonCancelled') : t('engineering.workOrderDetail.reasonReopening')}
                  </p>
                  <label className="block font-mono text-[11px] text-ink3">
                    {t('engineering.workOrderDetail.requiredReason')}
                    <select
                      value={transitionReason}
                      onChange={(event) => setTransitionReason(event.target.value)}
                      className="mt-1.5 w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface"
                    >
                      <option value="">{t('engineering.workOrderDetail.selectReason')}</option>
                      {pendingTransition === 'on_hold' && <>
                        <option value="awaiting_parts">{t('engineering.workOrderDetail.awaitingParts')}</option>
                        <option value="awaiting_vendor">{t('engineering.workOrderDetail.awaitingVendor')}</option>
                        <option value="schedule_deferral">{t('engineering.workOrderDetail.scheduleDeferral')}</option>
                        <option value="safety_review">{t('engineering.workOrderDetail.safetyReview')}</option>
                      </>}
                      {pendingTransition === 'cancelled' && <>
                        <option value="duplicate">{t('engineering.workOrderDetail.duplicate')}</option>
                        <option value="no_longer_needed">{t('engineering.workOrderDetail.noLongerNeeded')}</option>
                        <option value="safety_review">{t('engineering.workOrderDetail.safetyReview')}</option>
                      </>}
                      {pendingTransition === 'open' && <>
                        <option value="reopened_after_failure">{t('engineering.workOrderDetail.reopenedAfterFailure')}</option>
                        <option value="reopened_on_request">{t('engineering.workOrderDetail.reopenedOnRequest')}</option>
                      </>}
                    </select>
                  </label>
                  <label className="block font-mono text-[11px] text-ink3">
                    {t('engineering.workOrderDetail.noteLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                    <textarea
                      value={transitionNote}
                      onChange={(event) => setTransitionNote(event.target.value)}
                      rows={2}
                      className="mt-1.5 w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface resize-none"
                    />
                  </label>
                  {transitionMutation.isError && <p className="text-xs text-[var(--alert)]">{t('engineering.workOrderDetail.transitionError')}</p>}
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => setPendingTransition(null)} disabled={transitionMutation.isPending}>{t('common.cancel')}</Button>
                    <Button variant="primary" onClick={submitTransition} disabled={!transitionReason || transitionMutation.isPending}>
                      {transitionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {t('engineering.workOrderDetail.saveChange')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Inline completion form */}
              {showCompleteForm && (
                <div className="mt-4 p-4 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-[var(--ready)]">{t('engineering.workOrderDetail.completeWorkOrderHeading')}</p>

                  <div>
                    <label className="block font-mono text-[11px] text-ink3 mb-1">
                      {t('programs.pmCompletion.notesLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                    </label>
                    <textarea
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      rows={3}
                      placeholder={t('engineering.workOrderDetail.completionNotesPlaceholder')}
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] resize-none bg-surface/70 backdrop-blur-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[11px] text-ink3 mb-1">
                        {t('engineering.workOrderDetail.laborHoursLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={laborHours}
                        onChange={(e) => setLaborHours(e.target.value)}
                        placeholder={t('engineering.workOrderDetail.laborHoursPlaceholder')}
                        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] bg-surface/70 backdrop-blur-sm"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[11px] text-ink3 mb-1">
                        {t('programs.pmCompletion.partsUsed')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                      </label>
                      <input
                        type="text"
                        value={partsUsed}
                        onChange={(e) => setPartsUsed(e.target.value)}
                        placeholder={t('engineering.workOrderDetail.partsUsedPlaceholder')}
                        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)] bg-surface/70 backdrop-blur-sm"
                      />
                    </div>
                  </div>

                  {completeMutation.isError && (
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                      {t('engineering.workOrderDetail.completeError')}
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
                      {t('engineering.workOrderDetail.submitCompletion')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setShowCompleteForm(false)}
                      className="px-3 py-2 text-sm text-ink2 hover:text-ink transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section: Push to Housekeeping */}
          {fullWo.room_id && (isEngineer || isChief || isGM) && (
            <div className="p-5">
              <SectionLabel>{t('engineering.workOrderDetail.pushToHousekeepingHeading')}</SectionLabel>
              {hkTaskSuccess ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ready)] bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {t('engineering.workOrderDetail.taskPushed')}
                  <button
                    type="button"
                    onClick={() => setHkTaskSuccess(false)}
                    className="ml-auto text-[var(--ready)] hover:text-[var(--ready)]"
                    aria-label={t('engineering.workOrderDetail.dismiss')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[12px] text-ink3">
                    {t('engineering.workOrderDetail.createTaskFor')}{' '}
                    <span className="font-medium text-ink">
                      {t('engineering.workOrderCard.room')} {fullWo.rooms?.room_number}
                    </span>.
                  </p>
                  <textarea
                    aria-label={t('engineering.workOrderDetail.hkMessageAriaLabel')}
                    value={hkTaskNote}
                    onChange={(e) => setHkTaskNote(e.target.value)}
                    rows={2}
                    placeholder={t('engineering.workOrderDetail.hkNotePlaceholder')}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface/70 backdrop-blur-sm resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <label htmlFor="hk-push-priority" className="sr-only">{t('engineering.workOrderDetail.priorityLabel')}</label>
                    <select
                      id="hk-push-priority"
                      value={hkTaskPriority}
                      onChange={(e) => setHkTaskPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                      className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    >
                      <option value="normal">{t('engineering.workOrderDetail.priorityNormal')}</option>
                      <option value="urgent">{t('engineering.workOrderDetail.priorityUrgent')}</option>
                      <option value="low">{t('engineering.workOrderDetail.priorityLow')}</option>
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
                      {t('engineering.workOrderDetail.pushToHousekeepingHeading')}
                    </Button>
                  </div>
                  {hkTaskMutation.isError && (
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                      {t('engineering.workOrderDetail.hkTaskError')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section: Photos */}
          {(isEngineer || isChief || isGM) && (
            <div className="p-5">
              <SectionLabel>{t('engineering.workOrderDetail.photosHeading')}</SectionLabel>

              {/* Photo grid */}
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {photos.map((photo) => {
                    const url = getPhotoUrl(photo.storage_path, photo.photo_url)
                    const typeLabel = photo.photo_type.charAt(0).toUpperCase() + photo.photo_type.slice(1)
                    return (
                      <a
                        key={photo.id}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative group block rounded-lg overflow-hidden border border-line bg-surface-3"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`${typeLabel} photo`}
                          className="w-full h-28 object-cover group-hover:opacity-90 transition-opacity"
                        />
                        <span className="absolute bottom-1 left-1 font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/50 text-white">
                          {typeLabel}
                        </span>
                      </a>
                    )
                  })}
                </div>
              )}

              {/* Upload area */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setPhotoFile(f)
                  setPhotoPreview(f ? URL.createObjectURL(f) : null)
                  setPhotoError(null)
                  e.target.value = ''
                }}
              />

              {photoPreview ? (
                <div className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden border border-line bg-surface-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoPreview} alt={t('engineering.workOrderDetail.previewAlt')} className="w-full max-h-40 object-contain" />
                    <button
                      type="button"
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                      className="absolute top-1.5 right-1.5 p-1 bg-white/90 rounded-full shadow-sm text-gray-600 hover:text-gray-900 border border-gray-200 transition-colors"
                      aria-label={t('engineering.workOrderDetail.removePhoto')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="wo-photo-type" className="sr-only">{t('engineering.workOrderDetail.photoTypeLabel')}</label>
                    <select
                      id="wo-photo-type"
                      value={photoType}
                      onChange={(e) => setPhotoType(e.target.value as 'before' | 'after' | 'progress')}
                      className="text-sm border border-line rounded-lg px-2.5 py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    >
                      <option value="before">{t('engineering.workOrderDetail.photoTypeBefore')}</option>
                      <option value="progress">{t('engineering.workOrderDetail.photoTypeProgress')}</option>
                      <option value="after">{t('engineering.workOrderDetail.photoTypeAfter')}</option>
                    </select>
                    <Button
                      variant="primary"
                      onClick={() => uploadPhotoMutation.mutate()}
                      disabled={uploadPhotoMutation.isPending}
                      className="flex-1"
                    >
                      {uploadPhotoMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="w-3.5 h-3.5" />
                      )}
                      {t('engineering.workOrderDetail.uploadPhoto')}
                    </Button>
                  </div>
                  {photoError && (
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                      {photoError}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full h-16 border border-dashed border-line rounded-lg flex items-center justify-center gap-2 text-sm text-ink3 hover:bg-surface-3 hover:border-line-2 transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                  {t('engineering.workOrderDetail.addPhoto')}
                </button>
              )}
            </div>
          )}

          {/* Section: Timeline / Comments */}
          <div className="p-5">
            <SectionLabel>{t('engineering.workOrderDetail.timelineHeading')}</SectionLabel>

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
              <p className="text-sm text-ink3 mb-4">{t('engineering.workOrderDetail.noActivity')}</p>
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
                            {formatTs(c.created_at, t) ?? '—'}
                          </span>
                          {c.is_system && (
                            <span className="text-[11px] text-[var(--ai)] font-medium">{t('engineering.workOrderDetail.systemLabel')}</span>
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
                aria-label={t('engineering.workOrderDetail.addCommentAriaLabel')}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
                placeholder={t('engineering.workOrderDetail.addCommentPlaceholder')}
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
                {t('engineering.workOrderDetail.addComment')}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Sticky action bar ── */}
        {(canClaim || canComplete || canHold || canCancel || canResume || canReopen || canEscalate) && (
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
                {t('engineering.workOrderDetail.claim')}
              </Button>
            )}
            {canComplete && (
              <Button
                variant="secondary"
                onClick={() => setShowCompleteForm((v) => !v)}
                className="flex-1 border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {t('engineering.workOrderDetail.complete')}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="ghost"
                onClick={() => openTransitionDialog('cancelled')}
                disabled={transitionMutation.isPending}
                className="text-ink3 border-line hover:text-[var(--alert)] hover:border-[var(--alert-line)] hover:bg-[var(--alert-soft)]"
              >
                {transitionMutation.isPending && pendingTransition === 'cancelled' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                {t('common.cancel')}
              </Button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm text-ink3 hover:text-ink border border-line rounded-lg hover:bg-surface-3 transition-colors"
            >
              {t('engineering.workOrderDetail.closeButton')}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
