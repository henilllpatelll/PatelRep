'use client'

import { useTranslation } from 'react-i18next'
import { CheckSquare, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getPrimaryRoomAttention,
  getRoomWorkloadCredits,
  type HousekeepingOperationalRoom,
} from '@/lib/housekeeping/roomState'
import { CLEAN_TYPE_OPTIONS, getCleanTypeShortLabel, type CleanType } from '@/lib/utils/cleanType'

interface Props {
  room: HousekeepingOperationalRoom
  selected: boolean
  onToggleSelect: (roomId: string) => void
  onOpenDetail: (room: HousekeepingOperationalRoom) => void
  stagedToName: string | null
  ownerName: string | null
  onChangeCleanType?: (roomId: string, cleanType: CleanType) => void
  onUnassign?: (room: HousekeepingOperationalRoom) => void
}

function formatTime(value: string | null, locale: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(parsed)
}

/**
 * Assign-mode-only row: room + clean type + credits + assignment +
 * priority/deadline. Deliberately skips the operational RoomCard's checklist
 * counts, photo counts, and historical timing — none of that helps workload
 * planning.
 */
export function AssignmentRoomRow({ room, selected, onToggleSelect, onOpenDetail, stagedToName, ownerName, onChangeCleanType, onUnassign }: Props) {
  const { t, i18n } = useTranslation()
  const credits = getRoomWorkloadCredits(room)
  const attention = getPrimaryRoomAttention(room)
  const isRush = room.priority !== null && room.priority <= 2
  const arrivalTime = formatTime(room.checkinTime, i18n.language)
  const cleanTypeLabel = getCleanTypeShortLabel(room.cleanType)
  const canEditCleanType = Boolean(onChangeCleanType) && Boolean(stagedToName || ownerName)

  const assignmentLine = stagedToName
    ? t('housekeeping.assignWorkspace.row.stagedTo', { name: stagedToName })
    : ownerName
      ? t('housekeeping.assignWorkspace.row.assignedTo', { name: ownerName })
      : t('housekeeping.assignWorkspace.row.unassigned')

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[var(--r-md)] border px-2.5 py-2 transition-colors',
        selected ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-line bg-surface hover:bg-surface-2',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t('housekeeping.assignWorkspace.row.selectAria', { number: room.roomNumber })}
        onClick={() => onToggleSelect(room.roomId)}
        className="mt-0.5 shrink-0 text-ink3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        {selected ? <CheckSquare className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" /> : <Square className="h-4 w-4" aria-hidden="true" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={() => onOpenDetail(room)}
            className="font-mono text-sm font-semibold text-ink underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            {room.roomNumber}
          </button>
          {cleanTypeLabel && !canEditCleanType && (
            <span className="text-xs text-ink2">{cleanTypeLabel}</span>
          )}
          {canEditCleanType && (
            <span className="inline-flex items-center gap-0.5">
              {CLEAN_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={room.cleanType === option.value}
                  onClick={() => onChangeCleanType?.(room.roomId, option.value)}
                  title={option.label}
                  className={cn(
                    'rounded px-1 text-[10px] font-semibold uppercase',
                    room.cleanType === option.value ? 'bg-ink text-paper' : 'text-ink4 hover:text-ink2',
                  )}
                >
                  {option.value[0]}
                </button>
              ))}
            </span>
          )}
          <span className="text-xs text-ink3">{t('housekeeping.assignWorkspace.row.credits', { count: credits })}</span>
          {isRush && <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--alert)]">{t('housekeeping.boardV2.attention.categories.rush')}</span>}
          {room.isVip && <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--caution)]">{t('housekeeping.roomCard.vip')}</span>}
        </div>
        {arrivalTime && (
          <p className="mt-0.5 text-[11px] text-ink3">{t('housekeeping.assignWorkspace.row.arrival', { time: arrivalTime })}</p>
        )}
        {attention && (
          <p className="mt-0.5 text-[11px] font-medium text-[var(--alert)]">{t(`housekeeping.assignWorkspace.attention.${attention.code}`)}</p>
        )}
        <p className={cn('mt-0.5 text-xs', stagedToName ? 'text-[var(--accent)]' : 'text-ink2')}>{assignmentLine}</p>
      </div>

      {(stagedToName || ownerName) && onUnassign && (
        <button
          type="button"
          onClick={() => onUnassign(room)}
          className="shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] font-medium text-ink3 hover:bg-surface-3 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {t('housekeeping.assignWorkspace.row.unassign')}
        </button>
      )}
    </div>
  )
}
