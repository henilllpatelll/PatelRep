'use client'

import { CheckSquare, ClipboardList, MessageSquare, Square, UserRound, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { getRoomCardPresentation, getRoomWorkloadCredits, normalizeHousekeepingRoom, type HousekeepingAttentionCode, type RoomCardStatusKey } from '@/lib/housekeeping/roomState'

interface Props {
  room: any
  assignmentMode: boolean
  onStatusChange?: (roomId: string, newStatus: string) => void
  onOpenDetail?: (room: any) => void
  onAssign?: (roomId: string) => void
  pendingAssignee?: string | null
  assignedToName?: string | null
  assignmentTargetName?: string | null
  ownerName?: string | null
  assignedToActive?: boolean
  savedAssignmentId?: string | null
  onRemoveSavedAssignment?: (assignmentId: string) => void
  onRemoveMirroredAssignment?: (roomId: string) => void
  guestRequestCount?: number
  openTaskCount?: number
}

const STATUS_TONE: Record<RoomCardStatusKey, string> = {
  vacantDirty: 'bg-[var(--alert)]', pickup: 'bg-[var(--caution)]', cleaning: 'bg-[var(--progress)]', inspect: 'bg-[var(--info)]', ready: 'bg-[var(--ready)]', reclean: 'bg-[var(--alert)]', outOfOrder: 'bg-[var(--blocked)]', dnd: 'bg-[var(--ink-3)]', serviceDeclined: 'bg-[var(--ink-3)]', occupied: 'bg-[var(--alert)]',
}

/** Occupied reads as striped red on the top bar, matching the drawer header
 * and SimplifiedDashboard's occupied-room indicator. */
const OCCUPIED_STRIPE_STYLE = { backgroundImage: 'repeating-linear-gradient(135deg, var(--alert) 0 4px, rgba(255,255,255,0.55) 4px 8px)' } as const

const STATUS_BORDER: Record<RoomCardStatusKey, string> = {
  vacantDirty: 'border-[var(--alert-line)]', pickup: 'border-[var(--caution-line)]', cleaning: 'border-[var(--progress-line)]', inspect: 'border-[var(--info-line)]', ready: 'border-[var(--ready-line)]', reclean: 'border-[var(--alert-line)]', outOfOrder: 'border-[var(--blocked-line)]', dnd: 'border-line', serviceDeclined: 'border-line', occupied: 'border-[var(--alert-line)]',
}

const ATTENTION_KEY: Record<Exclude<HousekeepingAttentionCode, 'rush' | 'dnd' | 'service_declined'>, string> = {
  arrival_risk: 'arrivalRisk', ooo_arrival_conflict: 'arrivalConflict', failed_inspection: 'failedInspection', reclean: 'reclean', open_blocking_work_order: 'blockingWorkOrder', occupancy_discrepancy: 'occupancyDiscrepancy', unassigned_priority_room: 'unassignedPriority',
  dnd_welfare_escalation: 'dndWelfareEscalation', return_later_due: 'returnLaterDue',
}

function formatTime(value: string | undefined, locale: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(parsed)
}

function signalTranslationKey(kind: 'workOrder' | 'guestRequest' | 'task', count: number): string {
  return `housekeeping.roomCard.signal.${count === 1 ? kind : `${kind}s`}`
}

/** Compact room-board summary. Room Detail deliberately owns every other room fact. */
export function RoomCard({ room, assignmentMode, onStatusChange, onOpenDetail, onAssign, pendingAssignee, assignedToName, assignmentTargetName, ownerName, assignedToActive, savedAssignmentId, onRemoveSavedAssignment, onRemoveMirroredAssignment, guestRequestCount = 0, openTaskCount = 0 }: Props) {
  const { t, i18n } = useTranslation()
  const operationalRoom = normalizeHousekeepingRoom(room)
  const presentation = getRoomCardPresentation(operationalRoom, { guestRequestCount, taskCount: openTaskCount })
  const isPending = Boolean(pendingAssignee)
  const isSavedAssignedToActive = assignmentMode && Boolean(assignedToActive) && !isPending
  const isAssignmentSelected = assignmentMode && (isPending || isSavedAssignedToActive)
  const isSavingAssignment = isSavedAssignedToActive && Boolean(savedAssignmentId?.startsWith('optimistic-'))
  const isAlreadyAssigned = assignmentMode && Boolean(assignedToName) && !isAssignmentSelected
  const displayOwner = ownerName ?? presentation.assigneeName
  const conciseOwner = displayOwner?.split(' ')[0] ?? null
  const statusLabel = t(`housekeeping.roomCard.status.${presentation.statusKey}`)
  const contextLabel = presentation.contextKey ? t(`housekeeping.roomCard.context.${presentation.contextKey}`) : null
  const time = formatTime(presentation.timing?.at, i18n.language)
  const timingLabel = presentation.timing ? t(`housekeeping.roomCard.timing.${presentation.timing.key}`, { time, minutes: presentation.timing.minutes }) : null
  const attentionCode = presentation.primaryAttention?.code
  const exceptionLabel = attentionCode && attentionCode in ATTENTION_KEY
    ? t(`housekeeping.roomCard.exception.${ATTENTION_KEY[attentionCode as keyof typeof ATTENTION_KEY]}`)
    : null
  const cardSummary = [
    t('housekeeping.roomCard.roomNumber', { number: operationalRoom.roomNumber }), operationalRoom.roomType, statusLabel, contextLabel,
    conciseOwner ?? (presentation.statusKey !== 'ready' ? t('housekeeping.roomCard.unassigned') : null), timingLabel, exceptionLabel,
  ].filter(Boolean).join(', ')

  const activateCard = () => {
    if (isAssignmentSelected) return onOpenDetail?.(room)
    if (assignmentMode && onAssign) return onAssign(operationalRoom.roomId)
    onOpenDetail?.(room)
  }

  if (assignmentMode) {
    const assignmentOwner = isPending ? assignmentTargetName : displayOwner ?? assignmentTargetName
    const assignmentTiming = presentation.timing?.key === 'arrival' ? timingLabel : null
    return (
      <article className={cn('relative min-h-[126px] overflow-hidden rounded-[var(--r-lg)] border bg-surface p-3 transition-colors', STATUS_BORDER[presentation.statusKey], isAssignmentSelected && 'border-[var(--ai-line)] bg-[var(--ai-soft)] ring-1 ring-[var(--ai-line)]', isAlreadyAssigned && 'opacity-65')}>
        <span
          className={cn('pointer-events-none absolute inset-x-0 top-0 z-20 h-1', presentation.statusKey !== 'occupied' && STATUS_TONE[presentation.statusKey])}
          style={presentation.statusKey === 'occupied' ? OCCUPIED_STRIPE_STYLE : undefined}
          aria-hidden="true"
        />
        <button type="button" aria-label={cardSummary} onClick={activateCard} className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] outline-none transition-colors hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset" />
        <div className="relative z-10 flex min-h-[102px] flex-col pointer-events-none">
          <div className="flex items-start gap-2">
            {isAssignmentSelected ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ai)]" aria-hidden="true" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-ink3" aria-hidden="true" />}
            <div className="min-w-0"><p className="font-mono text-xl font-semibold leading-none tabular-nums text-ink">{operationalRoom.roomNumber}</p><p className="mt-1 truncate text-xs text-ink2">{contextLabel ?? statusLabel} · {t('housekeeping.roomCard.credits', { count: getRoomWorkloadCredits(operationalRoom) })}</p></div>
            <div className="ml-auto flex items-center gap-1 text-[10px] font-bold tracking-[0.08em]">{presentation.isRush && <span className="text-[var(--alert)]">{t('housekeeping.boardV2.attention.categories.rush')}</span>}{presentation.isVip && <span className="text-[var(--caution)]">{t('housekeeping.roomCard.vip')}</span>}</div>
          </div>
          <div className="mt-auto text-xs text-ink2">{isAssignmentSelected ? t('housekeeping.roomCard.staged', { name: assignmentOwner?.split(' ')[0] ?? t('housekeeping.roomCard.assigned') }) : isAlreadyAssigned ? t('housekeeping.roomCard.assignedTapToReassign', { name: assignedToName }) : t('housekeeping.roomCard.unassigned')}</div>
          {assignmentTiming && <p className="mt-1 text-[11px] text-ink3">{assignmentTiming}</p>}
          {isAssignmentSelected && <Button variant="ai" size="sm" className="pointer-events-auto mt-2 w-full" disabled={isSavingAssignment} onClick={() => { if (isSavingAssignment) return; if (isPending) onStatusChange?.(operationalRoom.roomId, '__remove_assignment'); else if (savedAssignmentId) onRemoveSavedAssignment?.(savedAssignmentId); else onRemoveMirroredAssignment?.(operationalRoom.roomId) }}>{isSavingAssignment ? t('housekeeping.roomCard.saving') : t('housekeeping.roomCard.remove')}</Button>}
        </div>
      </article>
    )
  }

  const showOwner = presentation.statusKey !== 'ready'
  const joinCleaningDurationToOwner = presentation.statusKey === 'cleaning' && Boolean(conciseOwner) && presentation.timing?.key === 'cleaningDuration'

  return (
    <article className={cn('relative h-[178px] overflow-hidden rounded-[var(--r-lg)] border bg-surface p-3 transition-colors', STATUS_BORDER[presentation.statusKey], presentation.statusKey === 'ready' && 'bg-[var(--ready-soft)]/35')}>
      <span
        className={cn('pointer-events-none absolute inset-x-0 top-0 z-20 h-1', presentation.statusKey !== 'occupied' && STATUS_TONE[presentation.statusKey])}
        style={presentation.statusKey === 'occupied' ? OCCUPIED_STRIPE_STYLE : undefined}
        aria-hidden="true"
      />
      <button type="button" aria-label={cardSummary} onClick={activateCard} className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] outline-none transition-colors hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset" />
      <div className="relative z-10 flex h-full flex-col pointer-events-none">
        <div className="flex items-start gap-2"><div className="min-w-0"><p className="font-mono text-[21px] font-semibold leading-none tabular-nums text-ink">{operationalRoom.roomNumber}</p>{operationalRoom.roomType && <p className="mt-1 font-mono text-[11px] leading-none text-ink3">{operationalRoom.roomType}</p>}</div><div className="ml-auto flex items-center gap-1 text-[10px] font-bold tracking-[0.08em]">{presentation.isRush && <span className="text-[var(--alert)]">{t('housekeeping.boardV2.attention.categories.rush')}</span>}{presentation.isVip && <span className="text-[var(--caution)]">{t('housekeeping.roomCard.vip')}</span>}</div></div>
        <div className="mt-5"><p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><span className={cn('h-2 w-2 rounded-full', STATUS_TONE[presentation.statusKey])} aria-hidden="true" />{statusLabel}</p>{contextLabel && <p className="mt-1 text-xs text-ink2">{contextLabel}</p>}</div>
        <div className="mt-4 min-h-[30px]">{showOwner && <p className={cn('flex items-center gap-1 text-xs', conciseOwner ? 'text-ink2' : 'font-medium text-ink3')}>{conciseOwner && <UserRound className="h-3 w-3 shrink-0" aria-hidden="true" />}{conciseOwner ?? t('housekeeping.roomCard.unassigned')}{joinCleaningDurationToOwner && <span className="text-ink3">· {timingLabel}</span>}</p>}{timingLabel && !joinCleaningDurationToOwner && <p className="mt-1 text-[11px] text-ink3">{timingLabel}</p>}</div>
        <div className="mt-auto flex min-h-[18px] items-end justify-between gap-2">{exceptionLabel ? <p className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-[var(--alert)]"><span aria-hidden="true">⚠</span><span className="truncate">{exceptionLabel}</span></p> : <span />}{presentation.secondarySignals.length > 0 && <div className="flex shrink-0 items-center gap-2 text-ink3">{presentation.secondarySignals.map((signal) => { const Icon = signal.kind === 'workOrder' ? Wrench : signal.kind === 'guestRequest' ? MessageSquare : ClipboardList; const label = t(signalTranslationKey(signal.kind, signal.count), { count: signal.count }); return <span key={signal.kind} className="flex items-center gap-0.5" title={label} aria-label={label}><Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-[11px] font-medium" aria-hidden="true">{signal.count}</span></span> })}</div>}</div>
      </div>
    </article>
  )
}
