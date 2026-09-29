'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { splitTaskBoardLanes, type Lane, type LaneKey } from '@/lib/utils/taskWorkspace'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { TaskLaneCard } from './TaskLaneCard'
import type { TaskNextActionContext } from './TaskNextAction'

const LANE_DOT: Record<LaneKey, string> = {
  new: 'var(--ink-4)',
  in_progress: 'var(--progress)',
  verify: 'var(--info)',
  done_today: 'var(--ready)',
}

export function TasksBoardView({ lanes, onOpen, actionContext }: { lanes: Lane[]; onOpen: (item: UnifiedTaskItem) => void; actionContext: TaskNextActionContext }) {
  const { t } = useTranslation()
  const [doneExpanded, setDoneExpanded] = useState(false)
  const { primary, doneToday } = splitTaskBoardLanes(lanes)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5">
      <div className="grid min-h-[280px] flex-1 auto-rows-fr grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {primary.map((lane) => (
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
              lane.items.map((item) => <TaskLaneCard key={item.id} item={item} onOpen={onOpen} actionContext={actionContext} />)
            )}
          </div>
        </div>
      ))}
      </div>
      <section className="shrink-0 overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface" aria-labelledby="done-today-heading">
        <button
          type="button"
          id="done-today-heading"
          aria-expanded={doneExpanded}
          aria-controls="done-today-content"
          onClick={() => setDoneExpanded((expanded) => !expanded)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
        >
          <span className="text-sm font-semibold text-[var(--ready)]">✓</span>
          <span className="text-sm font-semibold text-ink">{t('tasks.board.completedTodayCount', { count: doneToday.items.length })}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink3">{t(doneExpanded ? 'tasks.board.hide' : 'tasks.board.show')}<ChevronDown size={14} className={doneExpanded ? 'rotate-180' : ''} /></span>
        </button>
        {doneExpanded && (
          <div id="done-today-content" className="grid gap-2 border-t border-line bg-surface-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {doneToday.items.length === 0 ? <p className="col-span-full py-2 text-center text-xs text-ink4">&mdash;</p> : doneToday.items.map((item) => <TaskLaneCard key={item.id} item={item} onOpen={onOpen} actionContext={actionContext} compact />)}
          </div>
        )}
      </section>
    </div>
  )
}
