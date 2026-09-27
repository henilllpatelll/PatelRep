import { addDays, endOfDay, isSameDay, startOfDay } from 'date-fns'
import type { PMSchedule } from '@/lib/api/engineering'

export type PreventiveScheduleState = 'overdue' | 'due_today' | 'due_soon' | 'upcoming'

export function getScheduleState(schedule: PMSchedule, now = new Date()): PreventiveScheduleState {
  const due = new Date(schedule.next_due_at)
  if (due < startOfDay(now)) return 'overdue'
  if (isSameDay(due, now)) return 'due_today'
  if (due <= endOfDay(addDays(now, 7))) return 'due_soon'
  return 'upcoming'
}

export function getPreventiveMetrics(schedules: PMSchedule[], now = new Date()) {
  const active = schedules.filter((schedule) => schedule.is_active)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekEnd = endOfDay(addDays(now, 7))

  return {
    active: active.length,
    overdue: active.filter((schedule) => getScheduleState(schedule, now) === 'overdue').length,
    dueThisWeek: active.filter((schedule) => {
      const due = new Date(schedule.next_due_at)
      return due >= startOfDay(now) && due <= weekEnd
    }).length,
    completedThisMonth: active.filter((schedule) => {
      const completed = schedule.last_completed_at ? new Date(schedule.last_completed_at) : null
      return completed !== null && completed >= monthStart && completed <= now
    }).length,
  }
}

export function schedulesForDay(schedules: PMSchedule[], day: Date, now = new Date()) {
  return schedules
    .filter((schedule) => schedule.is_active)
    .filter((schedule) => isSameDay(new Date(schedule.next_due_at), day) || getScheduleState(schedule, now) === 'overdue')
    .sort((a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime())
}
