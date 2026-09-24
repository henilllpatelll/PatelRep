import type { Task, TaskStatus, Priority as TaskPriority } from '@/lib/api/tasks'
import type { GuestRequest, GuestRequestStatus } from '@/lib/api/guest_requests'

/**
 * A Guest Request auto-creates a linked Task (`guest_requests.task_id -> tasks.id`).
 * To hotel staff this must read as ONE item, not a Guest Request card plus a
 * separate Task card. UnifiedTaskItem is the normalized shape the Tasks screen
 * renders from — it never merges the two backend records, it just presents them
 * as one. `task` / `guestRequest` keep the raw records so drawers can still use
 * the real domain APIs (transitions, comments, messages, ...) untouched.
 */
export type UnifiedSourceType = 'guest_request' | 'internal'
export type UnifiedDisplayStatus = 'new' | 'in_progress' | 'verify' | 'done'

export interface UnifiedTaskItem {
  id: string
  sourceType: UnifiedSourceType
  taskId?: string
  guestRequestId?: string
  title: string
  description?: string
  roomNumber?: string
  locationText?: string
  priority: TaskPriority
  assigneeId?: string
  assigneeName?: string
  department?: string
  createdAt: string
  dueAt?: string
  startedAt?: string
  completedAt?: string
  taskStatus?: TaskStatus
  guestRequestStatus?: GuestRequestStatus
  displayStatus: UnifiedDisplayStatus
  isAiCreated: boolean
  /** Guest request whose auto-created Task failed to insert (or the link is stale/deleted) — no task_id to open a Task view for, render from the guest_request record alone. */
  isOrphanGuestRequest: boolean
  slaBreached: boolean
  task?: Task
  guestRequest?: GuestRequest
}

const GUEST_STATUS_TO_DISPLAY: Record<GuestRequestStatus, UnifiedDisplayStatus> = {
  open: 'new',
  acknowledged: 'in_progress',
  dispatched: 'in_progress',
  arrived: 'in_progress',
  guest_contacted: 'in_progress',
  reopened: 'in_progress',
  resolved: 'verify',
  verified: 'done',
  cancelled: 'done',
}

const TASK_STATUS_TO_DISPLAY: Record<TaskStatus, UnifiedDisplayStatus> = {
  open: 'new',
  in_progress: 'in_progress',
  escalated: 'in_progress',
  completed: 'done',
  cancelled: 'done',
}

function isPastDue(dueAt: string | undefined, displayStatus: UnifiedDisplayStatus): boolean {
  return !!dueAt && displayStatus !== 'done' && Date.now() > new Date(dueAt).getTime()
}

function fromGuestRequest(gr: GuestRequest, linkedTask: Task | undefined): UnifiedTaskItem {
  const displayStatus = GUEST_STATUS_TO_DISPLAY[gr.status] ?? 'new'
  const dueAt = gr.due_at ?? linkedTask?.due_at
  return {
    id: `guest-${gr.id}`,
    sourceType: 'guest_request',
    taskId: linkedTask?.id,
    guestRequestId: gr.id,
    title: gr.title,
    description: gr.description,
    roomNumber: gr.rooms?.room_number ?? linkedTask?.rooms?.room_number,
    locationText: linkedTask?.location_text,
    priority: gr.priority,
    assigneeId: linkedTask?.assigned_to ?? gr.assigned_to,
    assigneeName: linkedTask?.user_profiles?.preferred_name ?? linkedTask?.user_profiles?.full_name ?? undefined,
    department: gr.category,
    createdAt: gr.created_at,
    dueAt,
    startedAt: gr.dispatched_at ?? gr.acknowledged_at,
    completedAt: gr.verified_at ?? gr.resolved_at,
    taskStatus: linkedTask?.status,
    guestRequestStatus: gr.status,
    displayStatus,
    isAiCreated: linkedTask?.is_ai_created ?? false,
    isOrphanGuestRequest: !linkedTask,
    slaBreached: isPastDue(dueAt, displayStatus),
    task: linkedTask,
    guestRequest: gr,
  }
}

function fromInternalTask(task: Task): UnifiedTaskItem {
  const displayStatus = TASK_STATUS_TO_DISPLAY[task.status] ?? 'new'
  return {
    id: `task-${task.id}`,
    sourceType: 'internal',
    taskId: task.id,
    title: task.title,
    description: task.description,
    roomNumber: task.rooms?.room_number,
    locationText: task.location_text,
    priority: task.priority,
    assigneeId: task.assigned_to,
    assigneeName: task.user_profiles?.preferred_name ?? task.user_profiles?.full_name ?? undefined,
    department: task.task_type,
    createdAt: task.created_at,
    dueAt: task.due_at,
    startedAt: task.started_at,
    completedAt: task.completed_at,
    taskStatus: task.status,
    displayStatus,
    isAiCreated: task.is_ai_created,
    isOrphanGuestRequest: false,
    slaBreached: isPastDue(task.due_at, displayStatus),
    task,
  }
}

/**
 * Normalizes Tasks + Guest Requests into one deduped list. A guest_request whose
 * `task_id` matches a fetched task collapses into a single guest-sourced item
 * (the "consumed" task is dropped from the internal pass so it never renders
 * twice). Orphan guest_requests (task creation failed, or the link is stale)
 * still render — from the guest_request record alone — instead of disappearing.
 */
export function buildUnifiedTaskItems(tasks: Task[], guestRequests: GuestRequest[]): UnifiedTaskItem[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const consumedTaskIds = new Set<string>()

  const guestItems = guestRequests.map((gr) => {
    const linkedTask = gr.task_id ? taskById.get(gr.task_id) : undefined
    if (linkedTask) consumedTaskIds.add(linkedTask.id)
    return fromGuestRequest(gr, linkedTask)
  })

  // task_type === 'guest_request' tasks whose guest_request record is missing/deleted/stale
  // fall back to rendering as a plain internal item so a broken link can't hide the work.
  const internalItems = tasks
    .filter((t) => !consumedTaskIds.has(t.id))
    .map(fromInternalTask)

  return [...guestItems, ...internalItems]
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, normal: 1, low: 2 }
const STATUS_ORDER: Record<UnifiedDisplayStatus, number> = { new: 0, in_progress: 0, verify: 1, done: 2 }

/** Overdue/SLA-breached first, then urgent > normal > low, then soonest due date, then newest. Done items always sort last. */
export function sortUnifiedItems(items: UnifiedTaskItem[]): UnifiedTaskItem[] {
  return [...items].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.displayStatus] - STATUS_ORDER[b.displayStatus]
    if (statusDiff !== 0) return statusDiff

    if (a.slaBreached !== b.slaBreached) return a.slaBreached ? -1 : 1

    const priDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priDiff !== 0) return priDiff

    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    if (a.dueAt) return -1
    if (b.dueAt) return 1

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}
