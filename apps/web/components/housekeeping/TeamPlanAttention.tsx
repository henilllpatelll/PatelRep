'use client'

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import type { TeamPlanAttentionItem } from '@/lib/housekeeping/teamPlanView'

interface Props {
  items: TeamPlanAttentionItem[]
  canAssign: boolean
  onOpenRoom: (roomId: string) => void
  onAssignRoom: (roomId: string) => void
  onRebalance: (housekeeperId: string) => void
  onOpenGuestRequest: () => void
}

function itemLabelKey(code: TeamPlanAttentionItem['code']): string {
  if (code === 'guest_request') return 'housekeeping.teamPlan.attention.guestRequest'
  return `housekeeping.assignWorkspace.attention.${code}`
}

export function TeamPlanAttention({ items, canAssign, onOpenRoom, onAssignRoom, onRebalance, onOpenGuestRequest }: Props) {
  const { t, i18n } = useTranslation()

  return (
    <section aria-labelledby="team-plan-attention-title" className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
      <h2 id="team-plan-attention-title" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">
        {t('housekeeping.teamPlan.attention.title')}
      </h2>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink3">{t('housekeeping.teamPlan.attention.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((item) => {
            const at = item.at ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(item.at)) : null
            const detail = item.code === 'guest_request'
              ? item.title
              : item.code === 'dnd' && at
                ? t('housekeeping.teamPlan.attention.retryAt', { time: at })
                : (item.code === 'arrival_risk' || item.code === 'unassigned_priority_room' || item.code === 'ooo_arrival_conflict') && at
                  ? t('housekeeping.teamPlan.attention.arrivalAt', { time: at })
                  : item.assigneeName

            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => (item.code === 'guest_request' ? onOpenGuestRequest() : item.roomId && onOpenRoom(item.roomId))}
                  className="min-w-0 flex-1 rounded-[var(--r-sm)] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {item.roomNumber && <span className="font-mono text-sm font-semibold text-ink">{item.roomNumber}</span>}
                    <span className="text-xs text-ink2">{t(itemLabelKey(item.code))}</span>
                  </span>
                  {detail && <span className="mt-0.5 block truncate text-xs text-ink3">{detail}</span>}
                </button>
                {canAssign && item.actionKind === 'assign' && item.roomId && (
                  <Button variant="outline" size="sm" onClick={() => onAssignRoom(item.roomId as string)}>
                    {t('housekeeping.teamPlan.attention.assign')}
                  </Button>
                )}
                {canAssign && item.actionKind === 'rebalance' && item.assigneeId && (
                  <Button variant="outline" size="sm" onClick={() => onRebalance(item.assigneeId as string)}>
                    {t('housekeeping.teamPlan.attention.rebalance')}
                  </Button>
                )}
                {item.actionKind === 'open' && item.code !== 'guest_request' && item.roomId && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenRoom(item.roomId as string)}>
                    {t('housekeeping.teamPlan.attention.open')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
