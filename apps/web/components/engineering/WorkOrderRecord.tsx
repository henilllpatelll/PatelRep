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
  Send,
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
  GitMerge,
  Moon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns'
import Link from 'next/link'
import {
  engineeringApi,
  type TransitionWorkOrderPayload,
  type WorkOrder,
  type WorkOrderComment,
  type WorkOrderStatus,
} from '@/lib/api/engineering'
import { tasksApi } from '@/lib/api/tasks'
import { inventoryApi } from '@/lib/api/inventory'
import { useRole } from '@/lib/hooks/useRole'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { Button, IconButton } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Pill, AILabel, SectionLabel } from '@/components/ui/primitives'
import { getAvatarColor } from '@/lib/utils/avatar'

/** ids here are staff/system UUIDs, not display names -- there is no client-side name lookup. */
function shortId(id: string): string {
  return id.slice(0, 2).toUpperCase()
}

interface Props {
  wo: WorkOrder
  onUpdate: () => void
  /** Omit for inline (Console) use -- the close control hides itself. */
  onClose?: () => void
  startInEditMode?: boolean
  /** Pre-opens the matching inline action (kanban drag-to-column shortcuts) instead of a silent status change, since hold/cancel/reopen require a reason and completion requires notes/labor/parts. */
  autoAction?: 'complete' | 'hold' | 'cancel' | 'reopen'
  /** Active out-of-order reason for the WO's room, if any -- computed by the caller (a single shared query keyed on whichever WO is selected). */
  roomUnavailabilityReason?: string | null
}

type RecordTab = 'details' | 'timeline' | 'parts'

const CATEGORY_ICONS: Record<string, string> = {
  plumbing:   '💧',
  electrical: '⚡',
  hvac:       '❄️',
  furniture:  '🪑',
  appliance:  '🔌',
  structural: '🏗️',
  safety:     '🛡️',
  doors_locks: '🔒',
  painting:   '🎨',
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

function isSnoozedNow(snoozedUntil: string | undefined | null): boolean {
  return !!snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()
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

export function WorkOrderRecord({ wo, onClose, onUpdate, startInEditMode, autoAction, roomUnavailabilityReason }: Props) {
  const { t } = useTranslation()
  const { role, isGM } = useRole()
  const queryClient = useQueryClient()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const isEngineer = role === 'engineer'
  const isChief = role === 'chief_engineer'

  const [activeTab, setActiveTab] = useState<RecordTab>('details')

  // Completion form state
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const [laborHours, setLaborHours] = useState('')
  const [partsUsed, setPartsUsed] = useState('')
  const [partsConsumed, setPartsConsumed] = useState<Array<{ part_id: string; location_id: string; quantity: number }>>([])
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

  // Duplicate-signal / merge state
  const [showSignals, setShowSignals] = useState(false)
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)

  // Parts tab — logging a new part against this (open) work order
  const [partAddPartId, setPartAddPartId] = useState('')
  const [partAddLocationId, setPartAddLocationId] = useState('')
  const [partAddQty, setPartAddQty] = useState('1')

  // Checklist tab — adding a custom step
  const [newChecklistLabel, setNewChecklistLabel] = useState('')

  // Edit mode
  const [isEditing, setIsEditing] = useState(startInEditMode ?? false)
  const [editForm, setEditForm] = useState({
    title: wo.title,
    description: wo.description ?? '',
    category: wo.category,
    priority: wo.priority,
    notes: wo.notes ?? '',
  })

  // Fetch full WO detail (includes comments and photos)
  const { data: woDetail, isLoading: detailLoading, isError: detailError, refetch: refetchDetail } = useQuery({
    queryKey: ['work-order-detail', wo.id],
    queryFn: () => engineeringApi.getWorkOrder(wo.id),
    staleTime: 10_000,
  })

  const fullWo: WorkOrder = (woDetail?.data ?? wo) as WorkOrder
  const comments: WorkOrderComment[] = fullWo?.work_order_comments ?? []
  const photos = fullWo?.work_order_photos ?? []

  // Only fetched once the completion form is actually open -- avoids a
  // network call on every record view for work orders nobody is closing.
  // Also feeds the Parts tab's "log a part" mini-form.
  const partsQuery = useQuery({
    queryKey: ['engineering-parts'],
    queryFn: () => inventoryApi.listParts(),
    enabled: showCompleteForm || activeTab === 'parts',
  })
  const inventoryParts = partsQuery.data?.data ?? []
  const locationsQuery = useQuery({
    queryKey: ['engineering-part-locations'],
    queryFn: () => inventoryApi.listLocations(),
    enabled: showCompleteForm || activeTab === 'parts',
  })
  const inventoryLocations = locationsQuery.data?.data ?? []

  // Checklist (migration 110) -- seeded by category template at WO creation,
  // editable per WO thereafter.
  const checklistQuery = useQuery({
    queryKey: ['work-order-checklist', wo.id],
    queryFn: () => engineeringApi.listChecklistItems(wo.id),
    staleTime: 10_000,
  })
  const checklistItems = checklistQuery.data?.data ?? []

  const toggleChecklistMutation = useMutation({
    mutationFn: ({ itemId, isDone }: { itemId: string; isDone: boolean }) =>
      engineeringApi.toggleChecklistItem(wo.id, itemId, isDone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-order-checklist', wo.id] }),
  })

  const addChecklistItemMutation = useMutation({
    mutationFn: () => engineeringApi.addChecklistItem(wo.id, { label: newChecklistLabel.trim() }),
    onSuccess: () => {
      setNewChecklistLabel('')
      queryClient.invalidateQueries({ queryKey: ['work-order-checklist', wo.id] })
    },
  })

  // Parts tab -- transactions already logged against this WO (migration 102).
  const woPartsQuery = useQuery({
    queryKey: ['work-order-parts', wo.id],
    queryFn: () => engineeringApi.listWorkOrderParts(wo.id),
    enabled: activeTab === 'parts',
  })
  const woParts = woPartsQuery.data?.data ?? []

  const addPartMutation = useMutation({
    mutationFn: () =>
      inventoryApi.createTransaction(partAddPartId, {
        transaction_type: 'remove',
        location_id: partAddLocationId,
        quantity: Number(partAddQty),
        work_order_id: wo.id,
        note: 'Logged from work order Parts tab',
      }),
    onSuccess: () => {
      setPartAddPartId('')
      setPartAddLocationId('')
      setPartAddQty('1')
      queryClient.invalidateQueries({ queryKey: ['work-order-parts', wo.id] })
    },
  })

  // Duplicate-signal heuristic (migration 110) -- only meaningful while the
  // WO is still open, and only once it's linked to an asset.
  const duplicateSignalQuery = useQuery({
    queryKey: ['work-order-duplicate-signal', wo.id],
    queryFn: () => engineeringApi.getDuplicateSignal(wo.id),
    enabled: !['completed', 'cancelled'].includes(wo.status) && !!wo.asset_id,
    staleTime: 60_000,
  })
  const duplicateSignal = duplicateSignalQuery.data?.data ?? null

  const mergeMutation = useMutation({
    mutationFn: (targetId: string) => engineeringApi.mergeWorkOrder(wo.id, targetId),
    onSuccess: () => {
      setMergeConfirmOpen(false)
      invalidate()
      onUpdate()
      onClose?.()
    },
  })

  const snoozeMutation = useMutation({
    mutationFn: () => engineeringApi.snoozeWorkOrder(wo.id, 1),
    onSuccess: () => { invalidate(); onUpdate() },
  })

  const canClaim   = (isEngineer || isChief || isGM) && fullWo?.status === 'open'
  const canComplete = (isEngineer || isChief || isGM) && fullWo?.status === 'in_progress'
  const canHold    = (isChief || isGM) && fullWo?.status === 'in_progress'
  const canCancel  = (isChief || isGM) && (fullWo?.status === 'open' || fullWo?.status === 'on_hold')
  const canResume = (isChief || isGM) && fullWo?.status === 'on_hold'
  const canReopen = (isChief || isGM) && (fullWo?.status === 'completed' || fullWo?.status === 'cancelled')
  const canEscalate = (isEngineer || isChief || isGM) && !!fullWo && !['escalated', 'completed', 'cancelled'].includes(fullWo.status)
  // Backend allows escalated -> in_progress directly (no reason code) -- same rule the
  // board's drag-and-drop already relies on -- but no button surfaced it until now.
  const canResumeFromEscalated = (isEngineer || isChief || isGM) && fullWo?.status === 'escalated'

  // Mutations
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    queryClient.invalidateQueries({ queryKey: ['work-order-detail', wo.id] })
  }

  const claimMutation = useMutation({
    mutationFn: () => engineeringApi.claimWorkOrder(wo.id),
    onSuccess: () => { invalidate(); onUpdate() },
  })

  const completeMutation = useMutation({
    mutationFn: () => {
      const validPartsConsumed = partsConsumed.filter((row) => row.part_id && row.location_id && row.quantity > 0)
      return engineeringApi.completeWorkOrder(wo.id, {
        notes: completionNotes.trim() || undefined,
        labor_hours: laborHours ? parseFloat(laborHours) : undefined,
        parts_used: partsUsed.trim() || undefined,
        parts_consumed: validPartsConsumed.length ? validPartsConsumed : undefined,
      })
    },
    onSuccess: () => {
      setShowCompleteForm(false)
      setCompletionNotes('')
      setLaborHours('')
      setPartsUsed('')
      setPartsConsumed([])
      invalidate()
      onUpdate()
      onClose?.()
    },
  })

  const transitionMutation = useMutation({
    mutationFn: (payload: TransitionWorkOrderPayload) =>
      engineeringApi.transitionWorkOrder(wo.id, payload),
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
    mutationFn: () => engineeringApi.addComment(wo.id, commentText.trim()),
    onSuccess: () => {
      setCommentText('')
      refetchDetail()
    },
  })

  const uploadPhotoMutation = useMutation({
    mutationFn: () => engineeringApi.uploadWorkOrderPhoto(wo.id, photoFile!, photoType),
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
      engineeringApi.updateWorkOrder(wo.id, {
        title: editForm.title || undefined,
        description: editForm.description || undefined,
        category: editForm.category,
        priority: editForm.priority,
        notes: editForm.notes || undefined,
      }),
    onSuccess: () => { setIsEditing(false); invalidate() },
  })

  // Reset form state whenever the underlying work order changes
  useEffect(() => {
    setActiveTab('details')
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
      title: wo.title,
      description: wo.description ?? '',
      category: wo.category,
      priority: wo.priority,
      notes: wo.notes ?? '',
    })

    if (autoAction === 'complete' && wo.status === 'in_progress') {
      setShowCompleteForm(true)
    } else if (autoAction === 'hold' && (wo.status === 'in_progress' || wo.status === 'escalated')) {
      setPendingTransition('on_hold')
    } else if (autoAction === 'cancel' && (wo.status === 'open' || wo.status === 'on_hold' || wo.status === 'escalated' || wo.status === 'in_progress')) {
      setPendingTransition('cancelled')
    } else if (autoAction === 'reopen' && (wo.status === 'completed' || wo.status === 'cancelled')) {
      setPendingTransition('open')
    } else {
      setPendingTransition(null)
    }
    setTransitionReason('')
    setTransitionNote('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo.id, autoAction, startInEditMode])

  const sla = fullWo.due_at ? slaDisplay(fullWo.due_at, fullWo.status, t) : null
  const location = fullWo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${fullWo.rooms.room_number}`
    : fullWo.location_text ?? null
  const locationShort = fullWo.rooms?.room_number ? `R-${fullWo.rooms.room_number}` : location
  const zone = fullWo.assets?.zone

  // AI insight: show if ai_created with description or notes resembling insight text
  const aiInsightText = fullWo.is_ai_created ? (fullWo.description ?? fullWo.notes ?? null) : null

  const hasActions = canClaim || canComplete || canHold || canCancel || canResume || canReopen || canEscalate || canResumeFromEscalated
  const openedAgo = (() => {
    try { return formatDistanceToNowStrict(new Date(fullWo.created_at), { addSuffix: false }) } catch { return null }
  })()

  const TABS: { key: RecordTab; label: string; count?: number }[] = [
    { key: 'details', label: t('engineering.workOrderDetail.details') },
    { key: 'timeline', label: t('engineering.workOrderDetail.timelineHeading'), count: comments.length || undefined },
    { key: 'parts', label: t('engineering.workOrderDetail.partsTab'), count: woParts.length || undefined },
  ]

  const isSnoozed = isSnoozedNow(fullWo.snoozed_until)
  const canSnooze = (isEngineer || isChief || isGM) && !['completed', 'cancelled'].includes(fullWo.status)
  const canMerge = (isChief || isGM) && !!duplicateSignal

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-line px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={PRIORITY_TONE[fullWo.priority] ?? 'caution'} size="sm">{fullWo.priority}</Pill>
            <span className="font-mono text-[12px] text-ink3">WO-{fullWo.work_order_number}</span>
            <Pill tone={STATUS_TONE[fullWo.status] ?? 'neutral'} size="sm">{fullWo.status.replace(/_/g, ' ')}</Pill>
            {fullWo.is_pm_generated && <Pill tone="ready" size="sm">{t('engineering.workOrderCard.pm')}</Pill>}
            {fullWo.is_ai_created && <AILabel>{t('engineering.workOrderDetail.ai')}</AILabel>}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex gap-1.5">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                    activeTab === tab.key ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink2 hover:bg-surface-2'
                  }`}
                >
                  {tab.label}
                  {tab.count != null && <span className="ml-1 font-mono opacity-70">{tab.count}</span>}
                </button>
              ))}
            </div>
            {(isChief || isGM) && (
              <IconButton onClick={() => setIsEditing((v) => !v)} aria-label={t('engineering.workOrderDetail.editWorkOrder')}>
                <Pencil className="w-4 h-4" />
              </IconButton>
            )}
            {onClose && (
              <IconButton onClick={onClose} aria-label={t('engineering.workOrderDetail.closeDrawer')}>
                <X className="w-5 h-5" />
              </IconButton>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-[28px] font-normal leading-[1.15] text-ink">
            {fullWo.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5 text-[12px] text-ink3">
            {locationShort && <span className="font-mono">{locationShort}</span>}
            {locationShort && <span>·</span>}
            {zone ? <span>{zone}</span> : <span>{CATEGORY_ICONS[fullWo.category]} {fullWo.category}</span>}
            {openedAgo && <><span>·</span><span>{t('engineering.workOrderDetail.openedAgo', { time: openedAgo })}</span></>}
            {isSnoozed && <><span>·</span><span className="inline-flex items-center gap-1 text-[var(--caution)]"><Moon className="h-3 w-3" />{t('engineering.workOrderDetail.snoozedUntil', { time: formatTs(fullWo.snoozed_until, t) })}</span></>}
          </div>
        </div>

        {sla && (
          <div className={`mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] font-medium ${sla.overdue ? 'text-[var(--alert)]' : 'text-ink3'}`}>
            <Clock className="w-3 h-3" />
            {sla.overdue ? t('engineering.workOrderDetail.slaBreachedPrefix') : ''}
            {sla.text}
          </div>
        )}
      </div>

      {/* ── Scrollable tab body ── */}
      <div className="flex-1 overflow-y-auto">
        {v2 && detailError && !detailLoading && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--alert-line)]/40 bg-[var(--alert-soft)] px-5 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-[var(--alert)]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {t('engineering.workOrderDetail.loadError')}
            </p>
            <button type="button" onClick={() => refetchDetail()} className="shrink-0 text-xs font-medium text-[var(--alert)] underline">
              {t('common.retry')}
            </button>
          </div>
        )}

        {isEditing && (isChief || isGM) && (
          <div className="border-b border-[var(--caution-line)]/40 bg-[var(--caution-soft)]/60 p-5">
            <p className="mb-3 text-xs font-semibold text-[var(--caution)]">{t('engineering.workOrderDetail.editHeading')}</p>
            <div className="space-y-3">
              <input
                aria-label={t('engineering.workOrderDetail.titleAriaLabel')}
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t('engineering.workOrderDetail.titlePlaceholder')}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <textarea
                aria-label={t('engineering.workOrderDetail.descriptionAriaLabel')}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder={t('engineering.workOrderDetail.descriptionPlaceholder')}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label={t('engineering.workOrderDetail.categoryAriaLabel')}
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value as WorkOrder['category'] }))}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                >
                  {['plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural', 'safety', 'general'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  aria-label={t('engineering.workOrderDetail.priorityAriaLabel')}
                  value={editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as WorkOrder['priority'] }))}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
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
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => editMutation.mutate()} disabled={editMutation.isPending || !editForm.title.trim()} className="flex-1">
                  {editMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  {t('engineering.workOrderDetail.save')}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)}>{t('common.cancel')}</Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'details' && (
          <>
            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
              <div className="space-y-4">
                {aiInsightText && (
                  <div className="rounded-[var(--r-md)] border border-[var(--ai-line)] bg-[var(--ai-soft)] p-3.5">
                    <AILabel confidence={undefined}>{t('engineering.workOrderDetail.aiAnalysis')}</AILabel>
                    <p className="mt-2 font-display text-[13px] italic leading-[1.45] text-ink">{aiInsightText}</p>
                    {canClaim && (
                      <Button variant="ai" size="sm" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending} className="mt-2.5">
                        {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        {t('engineering.workOrderDetail.acceptInsight')}
                      </Button>
                    )}
                  </div>
                )}

                {duplicateSignal && (
                  <div className="rounded-[var(--r-md)] border border-[var(--ai-line)] bg-[var(--ai-soft)] p-3.5">
                    <AILabel confidence={duplicateSignal.confidence}>{t('engineering.workOrderDetail.duplicateInsightLabel')}</AILabel>
                    <p className="mt-2 font-display text-[13px] italic leading-[1.45] text-ink">
                      {t('engineering.workOrderDetail.duplicateInsightText', {
                        count: duplicateSignal.signals.length,
                        days: duplicateSignal.window_days,
                        target: duplicateSignal.candidate_wo_number,
                      })}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      {canMerge && (
                        <Button variant="ai" size="sm" onClick={() => setMergeConfirmOpen(true)} disabled={mergeMutation.isPending}>
                          {mergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                          {t('engineering.workOrderDetail.mergeWith', { target: duplicateSignal.candidate_wo_number })}
                        </Button>
                      )}
                      <button type="button" onClick={() => setShowSignals((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-ink3 hover:text-ink2">
                        {t('engineering.workOrderDetail.viewSignals')}
                        {showSignals ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    </div>
                    {showSignals && (
                      <ul className="mt-2.5 space-y-1.5 border-t border-[var(--ai-line)] pt-2.5">
                        {duplicateSignal.signals.map((s) => (
                          <li key={s.work_order_id} className="flex items-center justify-between gap-2 text-[12px] text-ink2">
                            <span className="truncate">WO-{s.work_order_number} · {s.title}{s.room_number ? ` · R-${s.room_number}` : ''}</span>
                            <span className="shrink-0 font-mono text-ink3">{formatTs(s.created_at, t)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {mergeConfirmOpen && (
                      <div className="mt-3 space-y-2 rounded-lg border border-[var(--ai-line)] bg-surface p-3">
                        <p className="text-sm font-medium text-ink">
                          {t('engineering.workOrderDetail.mergeConfirm', { source: fullWo.work_order_number, target: duplicateSignal.candidate_wo_number })}
                        </p>
                        {mergeMutation.isError && <p className="text-xs text-[var(--alert)]">{t('engineering.workOrderDetail.mergeError')}</p>}
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setMergeConfirmOpen(false)} disabled={mergeMutation.isPending}>{t('common.cancel')}</Button>
                          <Button variant="ai" size="sm" onClick={() => mergeMutation.mutate(duplicateSignal.candidate_wo_id)} disabled={mergeMutation.isPending}>
                            {mergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                            {t('engineering.workOrderDetail.mergeConfirmButton')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {fullWo.description && <p className="text-sm leading-relaxed text-ink2">{fullWo.description}</p>}
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-[13px]">
                  <dt className="text-ink3">{t('engineering.workOrderDetail.reporterLabel')}</dt>
                  <dd className="flex items-center gap-2 text-ink">
                    <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full text-[8px] font-semibold text-white ${getAvatarColor(fullWo.created_by)}`}>{shortId(fullWo.created_by)}</span>
                    {shortId(fullWo.created_by)}
                    {fullWo.guest_reported && <span className="text-ink3">({t('engineering.commandCenter.guest')})</span>}
                  </dd>
                  <dt className="text-ink3">{t('engineering.workOrderDetail.assigneeLabel')}</dt>
                  <dd className="flex items-center gap-2 text-ink">
                    {fullWo.assigned_to ? (
                      <>
                        <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full text-[8px] font-semibold text-white ${getAvatarColor(fullWo.assigned_to)}`}>{shortId(fullWo.assigned_to)}</span>
                        {shortId(fullWo.assigned_to)}
                      </>
                    ) : (
                      <span className="text-ink3">{t('engineering.workOrdersPage.unassigned')}</span>
                    )}
                  </dd>
                  {fullWo.assets && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.assetLabel')}</dt>
                      <dd className="text-ink">
                        <span className="font-mono">{fullWo.assets.name}</span>
                        {(fullWo.assets.manufacturer || fullWo.assets.model) && (
                          <span className="text-ink3"> · {[fullWo.assets.manufacturer, fullWo.assets.model].filter(Boolean).join(' ')}</span>
                        )}
                      </dd>
                    </>
                  )}
                  <dt className="text-ink3">{t('engineering.workOrderDetail.tradeLabel')}</dt>
                  <dd className="capitalize text-ink">{fullWo.category}</dd>
                  {fullWo.status === 'completed' && fullWo.total_cost != null && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.costLabel')}</dt>
                      <dd className="text-ink">
                        {t('engineering.workOrderDetail.costLine', {
                          labor: fullWo.labor_cost != null ? `$${fullWo.labor_cost.toFixed(2)}` : '—',
                          parts: fullWo.parts_cost != null ? `$${fullWo.parts_cost.toFixed(2)}` : '—',
                          total: `$${fullWo.total_cost.toFixed(2)}`,
                        })}
                      </dd>
                    </>
                  )}
                  {fullWo.due_at && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.dueLabel')}</dt>
                      <dd className={sla?.overdue ? 'font-medium text-[var(--alert)]' : 'text-ink'}>{formatTs(fullWo.due_at, t)}</dd>
                    </>
                  )}
                  {fullWo.created_at && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.createdLabel')}</dt>
                      <dd className="text-ink">{formatTs(fullWo.created_at, t)}</dd>
                    </>
                  )}
                  {fullWo.started_at && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.startedLabel')}</dt>
                      <dd className="text-ink">{formatTs(fullWo.started_at, t)}</dd>
                    </>
                  )}
                  {fullWo.completed_at && (
                    <>
                      <dt className="text-ink3">{t('engineering.workOrderDetail.completedLabel')}</dt>
                      <dd className="text-ink">{formatTs(fullWo.completed_at, t)}</dd>
                    </>
                  )}
                  {fullWo.parts_used && (
                    <>
                      <dt className="text-ink3">{t('programs.pmCompletion.partsUsed')}</dt>
                      <dd className="text-ink">{fullWo.parts_used}</dd>
                    </>
                  )}
                  {fullWo.notes && (
                    <>
                      <dt className="text-ink3">{t('programs.pmCompletion.notesLabel')}</dt>
                      <dd className="text-ink2">{fullWo.notes}</dd>
                    </>
                  )}
                </dl>
                {roomUnavailabilityReason && (
                  <div className="rounded-[var(--r-md)] border border-[var(--blocked-line)] bg-[var(--blocked-soft)] p-3 text-sm">
                    <p className="font-semibold text-ink">{t('engineering.workOrdersPage.roomOutOfOrder')}</p>
                    <p className="mt-1 text-ink2">{roomUnavailabilityReason}</p>
                    <Link href="/housekeeping/out-of-order" className="mt-2 inline-block text-[var(--accent)] hover:underline">
                      {t('engineering.workOrdersPage.viewOoo')}
                    </Link>
                  </div>
                )}
              </div>

              {(isEngineer || isChief || isGM) && (
                <div className="space-y-5">
                  {(checklistItems.length > 0 || !checklistQuery.isLoading) && (
                    <div>
                      <SectionLabel>{t('engineering.workOrderDetail.checklistHeading')}</SectionLabel>
                      {checklistItems.length > 0 && (
                        <ul className="space-y-2">
                          {checklistItems.map((item) => (
                            <li key={item.id} className="flex items-center gap-2.5 text-sm">
                              <input
                                type="checkbox"
                                checked={item.is_done}
                                onChange={(e) => toggleChecklistMutation.mutate({ itemId: item.id, isDone: e.target.checked })}
                                disabled={toggleChecklistMutation.isPending}
                                className="h-4 w-4 shrink-0 rounded border-line text-accent focus:ring-amber-400/50"
                              />
                              <span className={item.is_done ? 'flex-1 text-ink3 line-through' : 'flex-1 text-ink2'}>{item.label}</span>
                              {item.estimated_minutes != null && (
                                <span className="shrink-0 font-mono text-[11px] text-ink3">
                                  {t('engineering.workOrderDetail.checklistMinutesSuffix', { minutes: item.estimated_minutes })}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={newChecklistLabel}
                          onChange={(e) => setNewChecklistLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && newChecklistLabel.trim()) addChecklistItemMutation.mutate() }}
                          placeholder={t('engineering.workOrderDetail.checklistAddPlaceholder')}
                          className="min-h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-xs outline-none focus:ring-2 focus:ring-amber-400/50"
                        />
                        <IconButton
                          size="sm"
                          onClick={() => addChecklistItemMutation.mutate()}
                          disabled={!newChecklistLabel.trim() || addChecklistItemMutation.isPending}
                          aria-label={t('engineering.workOrderDetail.checklistAddButton')}
                        >
                          {addChecklistItemMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
                        </IconButton>
                      </div>
                    </div>
                  )}
                <div>
                  <SectionLabel hint={photos.length ? t('engineering.workOrderDetail.photosCount', { count: photos.length }) : undefined}>
                    {t('engineering.workOrderDetail.photosHeading')}
                  </SectionLabel>
                  {photos.length > 0 && (
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      {photos.map((photo) => {
                        const url = getPhotoUrl(photo.storage_path, photo.photo_url)
                        const typeLabel = photo.photo_type.charAt(0).toUpperCase() + photo.photo_type.slice(1)
                        return (
                          <a key={photo.id} href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-lg border border-line bg-surface-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`${typeLabel} photo`} className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90" />
                            <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">{typeLabel}</span>
                          </a>
                        )
                      })}
                    </div>
                  )}
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
                      <div className="relative overflow-hidden rounded-lg border border-line bg-surface-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoPreview} alt={t('engineering.workOrderDetail.previewAlt')} className="max-h-40 w-full object-contain" />
                        <IconButton variant="outline" size="sm" type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null) }} className="absolute right-1.5 top-1.5 rounded-full bg-white/90 shadow-sm" aria-label={t('engineering.workOrderDetail.removePhoto')}>
                          <X className="w-3 h-3" />
                        </IconButton>
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="wo-photo-type" className="sr-only">{t('engineering.workOrderDetail.photoTypeLabel')}</label>
                        <select id="wo-photo-type" value={photoType} onChange={(e) => setPhotoType(e.target.value as 'before' | 'after' | 'progress')} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50">
                          <option value="before">{t('engineering.workOrderDetail.photoTypeBefore')}</option>
                          <option value="progress">{t('engineering.workOrderDetail.photoTypeProgress')}</option>
                          <option value="after">{t('engineering.workOrderDetail.photoTypeAfter')}</option>
                        </select>
                        <Button variant="primary" onClick={() => uploadPhotoMutation.mutate()} disabled={uploadPhotoMutation.isPending} className="flex-1">
                          {uploadPhotoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                          {t('engineering.workOrderDetail.uploadPhoto')}
                        </Button>
                      </div>
                      {photoError && <p className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-xs text-[var(--alert)]">{photoError}</p>}
                    </div>
                  ) : (
                    <button type="button" onClick={() => photoInputRef.current?.click()} className="flex aspect-square w-full max-w-[104px] items-center justify-center gap-2 rounded-lg border border-dashed border-line text-sm text-ink3 transition-colors hover:border-line-2 hover:bg-surface-3">
                      <ImagePlus className="w-4 h-4" />
                    </button>
                  )}
                </div>
                </div>
              )}
            </div>

            {hasActions && (
              <div className="border-t border-line p-5">
                <SectionLabel>{t('engineering.workOrderDetail.sectionActions')}</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {canClaim && (
                    <Button variant="primary" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending}>
                      {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                      {t('engineering.workOrderDetail.claimWorkOrder')}
                    </Button>
                  )}
                  {canComplete && (
                    <Button variant="secondary" onClick={() => setShowCompleteForm((v) => !v)} className="border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100">
                      <CheckCircle className="w-3.5 h-3.5" />
                      {t('engineering.workOrderDetail.markComplete')}
                    </Button>
                  )}
                  {canHold && (
                    <Button variant="ghost" onClick={() => openTransitionDialog('on_hold')} disabled={transitionMutation.isPending} className="text-orange-700 border-orange-200 hover:bg-orange-50">
                      {transitionMutation.isPending && pendingTransition === 'on_hold' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
                      {t('engineering.workOrderDetail.putOnHold')}
                    </Button>
                  )}
                  {canResume && (
                    <Button variant="ghost" onClick={() => transitionMutation.mutate({ status: 'in_progress', source: 'web' })} disabled={transitionMutation.isPending} className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t('engineering.workOrderDetail.resume')}
                    </Button>
                  )}
                  {canReopen && (
                    <Button variant="ghost" onClick={() => openTransitionDialog('open')} disabled={transitionMutation.isPending} className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]">
                      {transitionMutation.isPending && pendingTransition === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      {t('engineering.workOrderDetail.reopen')}
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="destructive" onClick={() => openTransitionDialog('cancelled')} disabled={transitionMutation.isPending}>
                      {transitionMutation.isPending && pendingTransition === 'cancelled' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                      {t('common.cancel')}
                    </Button>
                  )}
                  {canEscalate && (
                    <Button variant="ghost" onClick={() => transitionMutation.mutate({ status: 'escalated', source: 'web' })} disabled={transitionMutation.isPending} className="text-[var(--alert)] border-[var(--alert-line)] hover:bg-[var(--alert-soft)]">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t('engineering.workOrderDetail.escalate')}
                    </Button>
                  )}
                </div>

                {pendingTransition && (
                  <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface-2 p-4">
                    <p className="text-sm font-semibold text-ink">
                      {pendingTransition === 'on_hold' ? t('engineering.workOrderDetail.reasonOnHold') : pendingTransition === 'cancelled' ? t('engineering.workOrderDetail.reasonCancelled') : t('engineering.workOrderDetail.reasonReopening')}
                    </p>
                    <label className="block font-mono text-[11px] text-ink3">
                      {t('engineering.workOrderDetail.requiredReason')}
                      <select value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
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
                      <textarea value={transitionNote} onChange={(event) => setTransitionNote(event.target.value)} rows={2} className="mt-1.5 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
                    </label>
                    {transitionMutation.isError && <p className="text-xs text-[var(--alert)]">{t('engineering.workOrderDetail.transitionError')}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setPendingTransition(null)} disabled={transitionMutation.isPending}>{t('common.cancel')}</Button>
                      <Button variant="primary" onClick={submitTransition} disabled={!transitionReason || transitionMutation.isPending}>
                        {transitionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {t('engineering.workOrderDetail.saveChange')}
                      </Button>
                    </div>
                  </div>
                )}

                {showCompleteForm && (
                  <div className="mt-4 space-y-3 rounded-xl border border-[var(--ready-line)] bg-[var(--ready-soft)] p-4">
                    <p className="text-sm font-semibold text-[var(--ready)]">{t('engineering.workOrderDetail.completeWorkOrderHeading')}</p>
                    <div>
                      <label className="mb-1 block font-mono text-[11px] text-ink3">
                        {t('programs.pmCompletion.notesLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                      </label>
                      <textarea
                        value={completionNotes}
                        onChange={(e) => setCompletionNotes(e.target.value)}
                        rows={3}
                        placeholder={t('engineering.workOrderDetail.completionNotesPlaceholder')}
                        className="w-full resize-none rounded-lg border border-line bg-surface/70 px-3 py-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block font-mono text-[11px] text-ink3">
                          {t('engineering.workOrderDetail.laborHoursLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                        </label>
                        <input
                          type="number" min="0" step="0.25"
                          value={laborHours}
                          onChange={(e) => setLaborHours(e.target.value)}
                          placeholder={t('engineering.workOrderDetail.laborHoursPlaceholder')}
                          className="w-full rounded-lg border border-line bg-surface/70 px-3 py-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-mono text-[11px] text-ink3">
                          {t('programs.pmCompletion.partsUsed')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                        </label>
                        <input
                          type="text"
                          value={partsUsed}
                          onChange={(e) => setPartsUsed(e.target.value)}
                          placeholder={t('engineering.workOrderDetail.partsUsedPlaceholder')}
                          className="w-full rounded-lg border border-line bg-surface/70 px-3 py-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-[var(--ready-line)]"
                        />
                      </div>
                    </div>
                    {inventoryParts.length > 0 && (
                      <div>
                        <label className="mb-1 block font-mono text-[11px] text-ink3">
                          {t('engineering.workOrderDetail.partsConsumedLabel')} <span className="font-normal">{t('programs.pmCompletion.optionalTag')}</span>
                        </label>
                        <div className="space-y-2">
                          {partsConsumed.map((row, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <select
                                aria-label={t('engineering.workOrderDetail.partsConsumedPartLabel')}
                                value={row.part_id}
                                onChange={(e) => setPartsConsumed((current) => current.map((r, i) => i === index ? { ...r, part_id: e.target.value } : r))}
                                className="min-h-9 flex-1 rounded-lg border border-line bg-surface/70 px-2 text-sm"
                              >
                                <option value="">{t('engineering.parts.choosePart')}</option>
                                {inventoryParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                              </select>
                              <select
                                aria-label={t('engineering.workOrderDetail.partsConsumedLocationLabel')}
                                value={row.location_id}
                                onChange={(e) => setPartsConsumed((current) => current.map((r, i) => i === index ? { ...r, location_id: e.target.value } : r))}
                                className="min-h-9 flex-1 rounded-lg border border-line bg-surface/70 px-2 text-sm"
                              >
                                <option value="">{t('engineering.parts.chooseLocation')}</option>
                                {inventoryLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                              </select>
                              <input
                                aria-label={t('engineering.parts.quantityLabel')}
                                type="number" min={0}
                                value={row.quantity}
                                onChange={(e) => setPartsConsumed((current) => current.map((r, i) => i === index ? { ...r, quantity: Number(e.target.value) } : r))}
                                className="min-h-9 w-16 rounded-lg border border-line bg-surface/70 px-2 text-sm"
                              />
                              <IconButton aria-label={t('engineering.workOrderDetail.removePartRow')} onClick={() => setPartsConsumed((current) => current.filter((_, i) => i !== index))}>
                                <X className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          ))}
                        </div>
                        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setPartsConsumed((current) => [...current, { part_id: '', location_id: '', quantity: 1 }])}>
                          {t('engineering.workOrderDetail.addPartRow')}
                        </Button>
                      </div>
                    )}
                    {completeMutation.isError && (
                      <p className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-xs text-[var(--alert)]">
                        {t('engineering.workOrderDetail.completeError')}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100">
                        {completeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        {t('engineering.workOrderDetail.submitCompletion')}
                      </Button>
                      <Button variant="ghost" size="sm" type="button" onClick={() => setShowCompleteForm(false)}>{t('common.cancel')}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {fullWo.room_id && (isEngineer || isChief || isGM) && (
              <div className="border-t border-line p-5">
                <SectionLabel>{t('engineering.workOrderDetail.pushToHousekeepingHeading')}</SectionLabel>
                {hkTaskSuccess ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--ready-line)] bg-[var(--ready-soft)] px-3 py-2 text-sm text-[var(--ready)]">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    {t('engineering.workOrderDetail.taskPushed')}
                    <IconButton variant="ghost" size="sm" type="button" onClick={() => setHkTaskSuccess(false)} className="ml-auto text-[var(--ready)] hover:text-[var(--ready)]" aria-label={t('engineering.workOrderDetail.dismiss')}>
                      <X className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12px] text-ink3">
                      {t('engineering.workOrderDetail.createTaskFor')}{' '}
                      <span className="font-medium text-ink">{t('engineering.workOrderCard.room')} {fullWo.rooms?.room_number}</span>.
                    </p>
                    <textarea
                      aria-label={t('engineering.workOrderDetail.hkMessageAriaLabel')}
                      value={hkTaskNote}
                      onChange={(e) => setHkTaskNote(e.target.value)}
                      rows={2}
                      placeholder={t('engineering.workOrderDetail.hkNotePlaceholder')}
                      className="w-full resize-none rounded-lg border border-line bg-surface/70 px-3 py-2 text-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                    />
                    <div className="flex items-center gap-2">
                      <label htmlFor="hk-push-priority" className="sr-only">{t('engineering.workOrderDetail.priorityLabel')}</label>
                      <select
                        id="hk-push-priority"
                        value={hkTaskPriority}
                        onChange={(e) => setHkTaskPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                      >
                        <option value="normal">{t('engineering.workOrderDetail.priorityNormal')}</option>
                        <option value="urgent">{t('engineering.workOrderDetail.priorityUrgent')}</option>
                        <option value="low">{t('engineering.workOrderDetail.priorityLow')}</option>
                      </select>
                      <Button variant="ghost" onClick={() => { if (hkTaskNote.trim()) hkTaskMutation.mutate() }} disabled={!hkTaskNote.trim() || hkTaskMutation.isPending} className="text-teal-700 border-teal-200 hover:bg-teal-50">
                        {hkTaskMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                        {t('engineering.workOrderDetail.pushToHousekeepingHeading')}
                      </Button>
                    </div>
                    {hkTaskMutation.isError && (
                      <p className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-xs text-[var(--alert)]">
                        {t('engineering.workOrderDetail.hkTaskError')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'parts' && (
          <div className="space-y-4 p-5">
            {woPartsQuery.isLoading ? (
              <div className="space-y-2">{[1, 2].map((id) => <Skeleton key={id} className="h-10" />)}</div>
            ) : woParts.length === 0 ? (
              <p className="text-sm text-ink3">{t('engineering.workOrderDetail.partsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {woParts.map((tx) => (
                  <li key={tx.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{tx.engineering_parts?.name ?? tx.part_id}</p>
                      <p className="truncate text-xs text-ink3">
                        {tx.engineering_part_locations?.name ?? '—'} · {formatTs(tx.created_at, t) ?? ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-ink2">
                      {Math.abs(tx.quantity_delta)} {tx.engineering_parts?.unit ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(isEngineer || isChief || isGM) && !['completed', 'cancelled'].includes(fullWo.status) && (
              <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                <SectionLabel>{t('engineering.workOrderDetail.partsAddHeading')}</SectionLabel>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    aria-label={t('engineering.workOrderDetail.partsConsumedPartLabel')}
                    value={partAddPartId}
                    onChange={(e) => setPartAddPartId(e.target.value)}
                    className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                  >
                    <option value="">{t('engineering.parts.choosePart')}</option>
                    {inventoryParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                  </select>
                  <select
                    aria-label={t('engineering.workOrderDetail.partsConsumedLocationLabel')}
                    value={partAddLocationId}
                    onChange={(e) => setPartAddLocationId(e.target.value)}
                    className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                  >
                    <option value="">{t('engineering.parts.chooseLocation')}</option>
                    {inventoryLocations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                  <input
                    aria-label={t('engineering.parts.quantityLabel')}
                    type="number"
                    min={1}
                    value={partAddQty}
                    onChange={(e) => setPartAddQty(e.target.value)}
                    className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                  />
                </div>
                {addPartMutation.isError && (
                  <p className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-xs text-[var(--alert)]">
                    {t('engineering.workOrderDetail.partsAddError')}
                  </p>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addPartMutation.mutate()}
                  disabled={!partAddPartId || !partAddLocationId || !partAddQty || addPartMutation.isPending}
                >
                  {addPartMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                  {t('engineering.workOrderDetail.partsAddButton')}
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="p-5">
            {detailLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex animate-pulse gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-surface-3" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 w-20 rounded bg-surface-3" />
                      <div className="h-3 w-4/5 rounded bg-surface-3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-ink3">{t('engineering.workOrderDetail.noActivity')}</p>
            ) : (
              <div className="relative">
                <div className="absolute bottom-2 left-1 top-2 w-px bg-line" />
                <div className="space-y-4">
                  {comments.map((c, i) => (
                    <div key={c.id} className="flex items-start gap-3 pl-1">
                      <div className={`relative z-10 mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface ${c.is_system ? 'bg-[var(--ai)]' : i === 0 ? 'bg-ink' : 'bg-ink3'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-1.5">
                          <span className="shrink-0 font-mono text-[11px] text-ink3">{formatTs(c.created_at, t) ?? '—'}</span>
                          {c.is_system && <span className="text-[11px] font-medium text-[var(--ai)]">{t('engineering.workOrderDetail.systemLabel')}</span>}
                        </div>
                        <p className="mt-0.5 text-[13px] leading-snug text-ink2">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky footer: comment + primary actions ── */}
      <div className="shrink-0 space-y-2.5 border-t border-line bg-surface px-5 py-3">
        <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-1.5">
          <input
            aria-label={t('engineering.workOrderDetail.addCommentAriaLabel')}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim()) commentMutation.mutate() }}
            placeholder={t('engineering.workOrderDetail.addCommentPlaceholder')}
            className="flex-1 border-none bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3"
          />
          <button type="button" onClick={() => { if (commentText.trim()) commentMutation.mutate() }} disabled={!commentText.trim() || commentMutation.isPending} className="shrink-0 text-accent disabled:opacity-40">
            {commentMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>

        {(hasActions || canSnooze) && (
          <div className="flex items-center gap-2">
            {canSnooze && (
              isSnoozed ? (
                <Button variant="outline" disabled className="shrink-0">
                  <Moon className="w-3.5 h-3.5" />
                  {t('engineering.workOrderDetail.snoozed')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => snoozeMutation.mutate()} disabled={snoozeMutation.isPending} className="shrink-0">
                  {snoozeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Moon className="w-3.5 h-3.5" />}
                  {t('engineering.workOrderDetail.snoozeButton')}
                </Button>
              )
            )}
            {canClaim && (
              <Button variant="primary" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending} className="flex-1 bg-accent text-white hover:bg-[#a23a18]">
                {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                {t('engineering.workOrderDetail.claim')}
              </Button>
            )}
            {canComplete && (
              <Button variant="secondary" onClick={() => setShowCompleteForm((v) => !v)} className="flex-1 border-[var(--ready-line)] text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('engineering.workOrderDetail.complete')}
              </Button>
            )}
            {canResumeFromEscalated && (
              <Button variant="primary" onClick={() => transitionMutation.mutate({ status: 'in_progress', source: 'web' })} disabled={transitionMutation.isPending} className="flex-1 bg-accent text-white hover:bg-[#a23a18]">
                {transitionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                {t('engineering.workOrderDetail.resumeFromEscalated')}
              </Button>
            )}
            {canResume && (
              <Button variant="primary" onClick={() => transitionMutation.mutate({ status: 'in_progress', source: 'web' })} disabled={transitionMutation.isPending} className="flex-1 bg-accent text-white hover:bg-[#a23a18]">
                {transitionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {t('engineering.workOrderDetail.resume')}
              </Button>
            )}
            {canHold && (
              <Button variant="ghost" onClick={() => openTransitionDialog('on_hold')} disabled={transitionMutation.isPending} className="text-orange-700 border-orange-200 hover:bg-orange-50">
                {transitionMutation.isPending && pendingTransition === 'on_hold' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
                {t('engineering.workOrderDetail.moveBackLabel')}
              </Button>
            )}
            {canReopen && (
              <Button variant="ghost" onClick={() => openTransitionDialog('open')} disabled={transitionMutation.isPending} className="text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]">
                {transitionMutation.isPending && pendingTransition === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {t('engineering.workOrderDetail.reopen')}
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" onClick={() => openTransitionDialog('cancelled')} disabled={transitionMutation.isPending} className="text-ink3 border-line hover:text-[var(--alert)] hover:border-[var(--alert-line)] hover:bg-[var(--alert-soft)]">
                {transitionMutation.isPending && pendingTransition === 'cancelled' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                {t('common.cancel')}
              </Button>
            )}
            {onClose && <Button variant="outline" onClick={onClose}>{t('engineering.workOrderDetail.closeButton')}</Button>}
          </div>
        )}
      </div>
    </div>
  )
}
