'use client'

import { useTranslation } from 'react-i18next'
import { Coffee } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils/avatar'
import type { TeamPlanLane as TeamPlanLaneData } from '@/lib/housekeeping/teamPlanView'
import { TeamPlanRoomBlock } from '@/components/housekeeping/TeamPlanRoomBlock'

export const TEAM_PLAN_PX_PER_MINUTE = 3.2
export const TEAM_PLAN_IDENTITY_WIDTH = 200
const BLOCK_GAP = 6
const MIN_BLOCK_WIDTH = 76

const CAPACITY_TONE: Record<TeamPlanLaneData['capacityState'], string> = {
  under: 'text-ink3',
  on: 'text-[var(--ready)]',
  at: 'text-[var(--caution)]',
  over: 'text-[var(--alert)]',
}

const PACE_TONE: Record<'on_pace' | 'tight' | 'behind', string> = {
  on_pace: 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]',
  tight: 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]',
  behind: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]',
}

function AvailabilityLine({ lane }: { lane: TeamPlanLaneData }) {
  const { t } = useTranslation()
  if (lane.availability === 'working' && lane.currentRoomNumber) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--progress)]" aria-hidden="true" />
        {t('housekeeping.teamPlan.lane.cleaningRoom', { room: lane.currentRoomNumber })}
      </span>
    )
  }
  if (lane.availability === 'on_break') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink2">
        <Coffee className="h-3 w-3" aria-hidden="true" />
        {t('housekeeping.assignWorkspace.team.availability.on_break')}
      </span>
    )
  }
  const dot = lane.availability === 'working' ? 'bg-[var(--progress)]' : lane.availability === 'available' ? 'bg-[var(--ready)]' : 'bg-ink4'
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink2">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
      {t(`housekeeping.assignWorkspace.team.availability.${lane.availability}`)}
    </span>
  )
}

interface Props {
  lane: TeamPlanLaneData
  windowStartMinute: number
  laneWidthPx: number
  nowLeftPx: number
  onOpenRoom: (roomId: string) => void
}

export function TeamPlanLane({ lane, windowStartMinute, laneWidthPx, nowLeftPx, onOpenRoom }: Props) {
  const { t } = useTranslation()
  const headingId = `team-plan-lane-${lane.id}`

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="grid border-b border-line last:border-b-0"
      style={{ gridTemplateColumns: `${TEAM_PLAN_IDENTITY_WIDTH}px ${laneWidthPx}px` }}
    >
      <div className="sticky left-0 z-[2] border-r border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-3 font-mono text-[11px] font-semibold text-ink2">
            {getInitials(lane.name)}
          </span>
          <h3 id={headingId} className="min-w-0 truncate text-[13px] font-semibold text-ink">{lane.name}</h3>
        </div>
        <p className={cn('mt-2 font-mono text-[12px] font-semibold', CAPACITY_TONE[lane.capacityState])}>
          {t('housekeeping.assignWorkspace.team.creditsOf', { current: lane.projectedCredits, target: lane.target })}
        </p>
        <p className="mt-0.5 text-[11px] text-ink3">
          {lane.floors.length > 0
            ? t('housekeeping.assignWorkspace.team.floors', { list: lane.floors.join('–') })
            : t('housekeeping.teamPlan.lane.noRooms')}
        </p>
        <div className="mt-1.5"><AvailabilityLine lane={lane} /></div>
        {lane.pace && (
          <span className={cn('mt-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', PACE_TONE[lane.pace])}>
            {t(`housekeeping.teamPlan.lane.pace.${lane.pace}`)}
          </span>
        )}
      </div>

      <div className="relative h-[84px] overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 border-l border-[var(--accent-line)]" style={{ left: nowLeftPx }} aria-hidden="true" />
        {lane.availability === 'on_break' && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 rounded-[var(--r-sm)] border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink2">
            {t('housekeeping.assignWorkspace.team.availability.on_break')}
          </span>
        )}
        {lane.stops.length === 0 ? (
          <p className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ink3">{t('housekeeping.teamPlan.lane.noRooms')}</p>
        ) : (
          lane.stops.map((stop) => {
            const left = (stop.startMinute - windowStartMinute) * TEAM_PLAN_PX_PER_MINUTE
            const width = Math.max(stop.durationMinutes * TEAM_PLAN_PX_PER_MINUTE - BLOCK_GAP, MIN_BLOCK_WIDTH)
            return (
              <span key={stop.roomId} className="contents">
                <TeamPlanRoomBlock stop={stop} style={{ left, width }} onOpen={onOpenRoom} />
                {stop.buildingChangeAfter && (
                  <span
                    className="pointer-events-none absolute inset-y-2 border-l border-dashed border-line-2"
                    style={{ left: left + width + BLOCK_GAP / 2 }}
                    aria-hidden="true"
                  />
                )}
              </span>
            )
          })
        )}
      </div>
    </div>
  )
}
