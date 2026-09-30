'use client'

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getCleanTypeShortLabel } from '@/lib/utils/cleanType'
import type { TeamPlanPoolRoom } from '@/lib/housekeeping/teamPlanView'

interface Props {
  rooms: TeamPlanPoolRoom[]
  totalCredits: number
  canAssign: boolean
  onOpenRoom: (roomId: string) => void
  onAssignRoom: (roomId: string) => void
}

export function TeamPlanUnassigned({ rooms, totalCredits, canAssign, onOpenRoom, onAssignRoom }: Props) {
  const { t } = useTranslation()

  return (
    <section aria-labelledby="team-plan-unassigned-title" className="rounded-[var(--r-lg)] border border-dashed border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="team-plan-unassigned-title" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">
          {t('housekeeping.teamPlan.unassigned.title')}
        </h2>
        <span className="font-mono text-xs text-ink3">
          {t('housekeeping.teamPlan.unassigned.summary', { count: rooms.length, credits: totalCredits })}
        </span>
      </div>

      {rooms.length === 0 ? (
        <p className="mt-3 text-sm text-ink3">{t('housekeeping.teamPlan.unassigned.empty')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {rooms.map((room) => {
            const cleanTypeLabel = getCleanTypeShortLabel(room.cleanType)
            const blockedLabel = room.blocked ? t('housekeeping.teamPlan.unassigned.blocked') : null
            const label = [
              t('housekeeping.roomCard.roomNumber', { number: room.roomNumber }),
              cleanTypeLabel,
              room.isRush && t('housekeeping.boardV2.attention.categories.rush'),
              blockedLabel,
              t('housekeeping.roomCard.credits', { count: room.credits }),
            ].filter(Boolean).join(', ')
            return (
              <button
                key={room.roomId}
                type="button"
                onClick={() => (canAssign && !room.blocked ? onAssignRoom(room.roomId) : onOpenRoom(room.roomId))}
                aria-label={canAssign && !room.blocked ? t('housekeeping.teamPlan.unassigned.assignAria', { label }) : label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--r-md)] border bg-surface px-2.5 py-1.5 text-left font-mono text-[12.5px] font-semibold text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  room.blocked ? 'border-line opacity-70' : room.isRush ? 'border-[var(--alert-line)]' : 'border-line',
                )}
              >
                {room.roomNumber}
                {cleanTypeLabel && <span className="font-sans text-[10px] font-semibold uppercase tracking-wide text-ink3">{cleanTypeLabel}</span>}
                {room.blocked
                  ? <span className="font-sans text-[10px] font-semibold uppercase text-ink3">{blockedLabel}</span>
                  : room.isRush && <span className="font-sans text-[10px] font-semibold uppercase text-[var(--alert)]">{t('housekeeping.boardV2.attention.categories.rush')}</span>}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
