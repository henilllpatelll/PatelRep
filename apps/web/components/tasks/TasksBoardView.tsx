'use client'

import { useTranslation } from 'react-i18next'
import { StatusDot } from '@/components/ui/primitives'
import type { Lane, LaneKey } from '@/lib/utils/taskWorkspace'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { TaskLaneCard } from './TaskLaneCard'

const LANE_DOT: Record<LaneKey, string> = {
  new: 'var(--ink-4)',
  in_progress: 'var(--progress)',
  verify: 'var(--info)',
  done_today: 'var(--ready)',
}

export function TasksBoardView({ lanes, onOpen }: { lanes: Lane[]; onOpen: (item: UnifiedTaskItem) => void }) {
  const { t } = useTranslation()

  return (
    <div className="grid h-full auto-rows-fr grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {lanes.map((lane) => (
        <div key={lane.key} className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-[15px] py-[13px]">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: LANE_DOT[lane.key] }} />
            <span className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink2">{t(`tasks.board.lanes.${lane.key}`)}</span>
            <span className={`ml-auto rounded-full px-2 py-[2px] text-[11px] ${lane.key === 'done_today' ? 'bg-[var(--ready-soft)] text-[var(--ready)]' : 'bg-surface-3 text-ink4'}`}>
              {lane.items.length}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto p-3">
            {lane.items.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink4">&mdash;</p>
            ) : (
              lane.items.map((item) => <TaskLaneCard key={item.id} item={item} onOpen={onOpen} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
