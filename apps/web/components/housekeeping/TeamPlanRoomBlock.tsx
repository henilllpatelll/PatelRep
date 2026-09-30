'use client'

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getCleanTypeShortLabel } from '@/lib/utils/cleanType'
import type { TeamPlanStop } from '@/lib/housekeeping/teamPlanView'

const STATUS_DOT: Record<string, string> = {
  done: 'bg-ink4',
  active: 'bg-[var(--progress)]',
  pending: 'bg-[var(--alert)]',
}

interface Props {
  stop: TeamPlanStop
  style?: React.CSSProperties
  onOpen: (roomId: string) => void
}

/** One compact room stop — deliberately minimal; Room Detail owns every other fact. */
export function TeamPlanRoomBlock({ stop, style, onOpen }: Props) {
  const { t, i18n } = useTranslation()
  const cleanTypeLabel = getCleanTypeShortLabel(stop.cleanType)
  const done = stop.state === 'done'
  const active = stop.state === 'active'

  // A blocked room (unresolved discrepancy) can't be actioned right now, so it
  // overrides the normal cleaning/arrival meta line entirely (spec section 30).
  const blockedLine = stop.occupancyDiscrepancy ? t('housekeeping.teamPlan.block.blocked') : null
  const retryLine = !stop.occupancyDiscrepancy && stop.dndRetryAt
    ? t('housekeeping.teamPlan.block.returnAfter', {
        time: new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(stop.dndRetryAt)),
      })
    : null

  const metaLine = blockedLine ?? retryLine ?? (active
    ? t('housekeeping.teamPlan.block.cleaning', { minutes: stop.durationMinutes })
    : done
      ? t('housekeeping.teamPlan.block.done')
      : stop.arrivalTime
        ? t('housekeeping.teamPlan.block.arrival', {
            time: new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(stop.arrivalTime)),
          })
        : null)

  const ariaLabel = [
    t('housekeeping.roomCard.roomNumber', { number: stop.roomNumber }),
    cleanTypeLabel,
    stop.isRush && t('housekeeping.boardV2.attention.categories.rush'),
    stop.isVip && t('housekeeping.roomCard.vip'),
    metaLine,
    stop.staged && t('housekeeping.teamPlan.block.staged'),
  ].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      onClick={() => onOpen(stop.roomId)}
      aria-label={ariaLabel}
      style={style}
      className={cn(
        'group absolute top-3 flex h-[58px] flex-col justify-center gap-1 overflow-hidden rounded-[var(--r-md)] border px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        done && 'border-line bg-surface-2 opacity-70',
        active && 'border-[var(--progress-line)] bg-[var(--progress-soft)] shadow-sm',
        stop.state === 'pending' && !stop.staged && 'border-line bg-surface hover:bg-surface-2',
        stop.staged && 'border-dashed border-[var(--accent-line)] bg-[var(--accent-soft)]',
        stop.occupancyDiscrepancy && 'border-[var(--alert-line)] bg-[var(--alert-soft)]',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[stop.state])} aria-hidden="true" />
        <span className="font-mono text-[13px] font-semibold leading-none text-ink">{stop.roomNumber}</span>
        {cleanTypeLabel && <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink3">{cleanTypeLabel}</span>}
      </span>
      <span className="flex items-center gap-1 text-[10px] font-medium">
        {stop.isRush && <span className="text-[var(--alert)]">{t('housekeeping.boardV2.attention.categories.rush')}</span>}
        {stop.isVip && <span className="text-[var(--caution)]">{t('housekeeping.roomCard.vip')}</span>}
        {metaLine && <span className={cn('truncate', stop.occupancyDiscrepancy ? 'font-semibold text-[var(--alert)]' : 'text-ink3')}>{metaLine}</span>}
      </span>
    </button>
  )
}
