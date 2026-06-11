import type { Task } from '@/lib/api/tasks'

/* On-device task intelligence — mirrors apps/mobile/lib/ai/tasks.ts so the
   web and mobile task queues order work identically. Free and instant; the
   paid AI path is only the natural-language composer. */

export type TaskBucket = 'overdue' | 'now' | 'today'

export interface TaskQueueEntry {
  task: Task
  position: number
  bucket: TaskBucket
  /** Minutes past due when overdue, otherwise null */
  overdueMinutes: number | null
}

const DUE_SOON_MS = 2 * 60 * 60 * 1000

function parseDue(task: Task): number | null {
  if (!task.due_at) return null
  const time = new Date(task.due_at).getTime()
  return Number.isNaN(time) ? null : time
}

export function isTaskOpen(task: Task): boolean {
  return task.status !== 'completed' && task.status !== 'cancelled'
}

export function getTaskBucket(task: Task, now: number): TaskBucket {
  const due = parseDue(task)
  if (due != null && due < now) return 'overdue'
  if (task.priority === 'urgent') return 'now'
  if (due != null && due - now <= DUE_SOON_MS) return 'now'
  return 'today'
}

function scoreTask(task: Task, now: number): number {
  const due = parseDue(task)
  if (due != null && due < now) return 0
  if (task.priority === 'urgent') return 10
  if (due != null && due - now <= DUE_SOON_MS) return 30
  if (task.task_type === 'guest_request') return 40
  if (task.priority === 'low') return 60
  return 50
}

/** Open tasks in the order they should be worked, with buckets and positions. */
export function buildTaskQueue(tasks: Task[], now: number): TaskQueueEntry[] {
  const open = tasks.filter(isTaskOpen)

  const ordered = [...open].sort((a, b) => {
    const scoreDelta = scoreTask(a, now) - scoreTask(b, now)
    if (scoreDelta !== 0) return scoreDelta
    const dueDelta = (parseDue(a) ?? Infinity) - (parseDue(b) ?? Infinity)
    if (dueDelta !== 0) return dueDelta
    return a.title.localeCompare(b.title)
  })

  return ordered.map((task, index) => {
    const due = parseDue(task)
    const overdueMinutes = due != null && due < now ? Math.max(1, Math.round((now - due) / 60000)) : null
    return { task, position: index + 1, bucket: getTaskBucket(task, now), overdueMinutes }
  })
}

export interface TaskBriefing {
  headline: string
  watchouts: string[]
}

/** On-device briefing — same voice as the mobile AI Task Briefing. */
export function buildTaskBriefing(queue: TaskQueueEntry[]): TaskBriefing {
  if (queue.length === 0) {
    return { headline: 'All caught up. No open tasks on the list.', watchouts: [] }
  }

  const overdue = queue.filter((entry) => entry.bucket === 'overdue')
  const first = queue[0]

  let headline: string
  if (overdue.length > 0) {
    headline = `${overdue.length} task${overdue.length > 1 ? 's' : ''} overdue — start with “${overdue[0].task.title}”.`
  } else if (first.task.priority === 'urgent') {
    headline = `Start with “${first.task.title}” — it's the highest priority.`
  } else {
    headline = `Next up: “${first.task.title}”.`
  }

  const watchouts: string[] = []
  const guestCount = queue.filter((entry) => entry.task.task_type === 'guest_request').length
  if (guestCount > 0) {
    watchouts.push(`${guestCount} guest-facing task${guestCount > 1 ? 's' : ''} — those make or break reviews.`)
  }
  const roomCount = queue.filter((entry) => entry.task.rooms?.room_number).length
  if (roomCount > 0) {
    watchouts.push(`${roomCount} task${roomCount > 1 ? 's' : ''} tied to specific rooms.`)
  }

  return { headline, watchouts: watchouts.slice(0, 2) }
}
