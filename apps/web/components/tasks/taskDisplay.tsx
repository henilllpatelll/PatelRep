'use client'

import { useEffect, useState } from 'react'
import { Bed, Users, HelpCircle } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Task, TaskType, Priority } from '@/lib/api/tasks'
import { Mono } from '@/components/ui/primitives'

// Internal Task type options for the MANUAL create/edit selector. 'guest_request' is
// deliberately excluded — a task is only ever guest-request-backed when a real Guest
// Request links to it via guest_requests.task_id, never by manual selection (spec #14).
// The backend enum/column still accepts 'guest_request' for the auto-creation path.
export function getTaskTypeOptions(t: TFunction): Array<{ value: TaskType; label: string }> {
  return [
    { value: 'housekeeping', label: t('tasks.types.housekeeping') },
    { value: 'engineering', label: t('tasks.typeLabels.engineering') },
    { value: 'lost_found', label: t('tasks.typeLabels.lostFound') },
    { value: 'general', label: t('tasks.types.general') },
  ]
}

// Full label map (incl. guest_request) — used for read-only display (badges, headers),
// never as selectable options.
export function getTaskTypeLabels(t: TFunction): Record<string, string> {
  return {
    housekeeping: t('tasks.types.housekeeping'),
    guest_request: t('tasks.types.guestRequest'),
    general: t('tasks.types.general'),
    engineering: t('tasks.typeLabels.engineering'),
    lost_found: t('tasks.typeLabels.lostFound'),
  }
}

export function getPriorityOptions(t: TFunction): Array<{ value: Priority; label: string }> {
  return [
    { value: 'urgent', label: t('tasks.priorities.urgent') },
    { value: 'normal', label: t('tasks.priorities.normal') },
    { value: 'low', label: t('tasks.priorities.low') },
  ]
}

export function priorityTone(p: Priority): 'alert' | 'caution' | 'neutral' {
  if (p === 'urgent') return 'alert'
  if (p === 'normal') return 'caution'
  return 'neutral'
}

export function taskTypeIcon(taskType: string) {
  if (taskType === 'housekeeping') return <Bed size={13} className="shrink-0" />
  if (taskType === 'guest_request') return <Users size={13} className="shrink-0" />
  return <HelpCircle size={13} className="shrink-0" />
}

export const SparkIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
  </svg>
)

export function formatDuration(t: TFunction, totalMinutes: number): string {
  const abs = Math.abs(totalMinutes)
  const days = Math.floor(abs / 1440)
  const hours = Math.floor((abs % 1440) / 60)
  const mins = abs % 60
  if (days >= 1) return days === 1 ? t('tasks.durationDayOne', { count: days }) : t('tasks.durationDayOther', { count: days })
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function DueTime({ dueAt, isDone, isOverdue }: { dueAt: string | undefined; isDone: boolean; isOverdue: boolean }) {
  const { t } = useTranslation()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!dueAt || isDone || now === null) return null
  const due = new Date(dueAt).getTime()
  const diffMin = Math.round((due - now) / 60000)
  const label = diffMin < 0
    ? t('tasks.dueTimeOverdue', { duration: formatDuration(t, diffMin) })
    : new Date(dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <Mono className={`text-[11px] min-w-[64px] text-right ${isOverdue ? 'text-[var(--alert)]' : 'text-ink3'}`}>
      {label}
    </Mono>
  )
}

export function taskDueTimeForTask(task: Task, now: number | null) {
  return { dueAt: task.due_at, isOverdue: !!(now && task.due_at && new Date(task.due_at).getTime() < now) }
}
