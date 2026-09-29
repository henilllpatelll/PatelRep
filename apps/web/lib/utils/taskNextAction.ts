import type { UserRole } from '@/stores/authStore'
import type { TaskCapabilities } from './taskCapabilities'
import type { UnifiedTaskItem } from './unifiedTasks'

export type TaskNextActionKey =
  | 'assign'
  | 'reassign'
  | 'claim'
  | 'start'
  | 'complete'
  | 'acknowledge'
  | 'dispatch'
  | 'arrived'
  | 'guest_contacted'
  | 'resolve'
  | 'verify'

export interface TaskNextAction {
  key: TaskNextActionKey
  labelKey: string
  successKey: string
}

const ACTIONS: Record<TaskNextActionKey, TaskNextAction> = {
  assign: { key: 'assign', labelKey: 'tasks.actions.assign', successKey: 'tasks.toast.assigned' },
  reassign: { key: 'reassign', labelKey: 'tasks.actions.reassign', successKey: 'tasks.toast.assigned' },
  claim: { key: 'claim', labelKey: 'tasks.actions.claim', successKey: 'tasks.toast.claimed' },
  start: { key: 'start', labelKey: 'tasks.actions.start', successKey: 'tasks.toast.started' },
  complete: { key: 'complete', labelKey: 'tasks.actions.complete', successKey: 'tasks.toast.completed' },
  acknowledge: { key: 'acknowledge', labelKey: 'tasks.actions.acknowledge', successKey: 'tasks.toast.acknowledged' },
  dispatch: { key: 'dispatch', labelKey: 'tasks.actions.dispatch', successKey: 'tasks.toast.dispatched' },
  arrived: { key: 'arrived', labelKey: 'tasks.actions.arrived', successKey: 'tasks.toast.arrived' },
  guest_contacted: { key: 'guest_contacted', labelKey: 'tasks.actions.contactGuest', successKey: 'tasks.toast.guestContacted' },
  resolve: { key: 'resolve', labelKey: 'tasks.actions.resolve', successKey: 'tasks.toast.resolved' },
  verify: { key: 'verify', labelKey: 'tasks.actions.verify', successKey: 'tasks.toast.verified' },
}

/**
 * Returns the one operationally relevant action for a task card. Internal tasks
 * and guest requests deliberately keep their independent backend state machines.
 */
export function getTaskNextAction(
  item: UnifiedTaskItem,
  capabilities: TaskCapabilities,
  role?: UserRole | null,
): TaskNextAction | null {
  if (item.finalOutcome || item.displayStatus === 'done') return null

  if (item.sourceType === 'internal') {
    if (!item.taskId) return null
    if (item.taskStatus === 'open') {
      if (!item.assigneeId) {
        if (role === 'housekeeper' && item.department === 'housekeeping') return ACTIONS.claim
        return capabilities.canAssign ? ACTIONS.assign : null
      }
      return capabilities.canUpdateTaskStatus ? ACTIONS.start : null
    }
    if (item.taskStatus === 'in_progress' || item.taskStatus === 'escalated') {
      return capabilities.canUpdateTaskStatus ? ACTIONS.complete : null
    }
    return null
  }

  // The transition route is currently authorized for every authenticated staff
  // role, so the UI mirrors that backend contract while still using its real API.
  switch (item.guestRequestStatus) {
    case 'open': return ACTIONS.acknowledge
    case 'acknowledged': return ACTIONS.dispatch
    case 'dispatched': return ACTIONS.arrived
    case 'arrived': return ACTIONS.guest_contacted
    case 'guest_contacted': return ACTIONS.resolve
    case 'resolved': return ACTIONS.verify
    case 'reopened': return ACTIONS.acknowledge
    default: return null
  }
}

/** Assignment is always written to the backing Task, never to a frontend-only field. */
export function getTaskAssignmentAction(item: UnifiedTaskItem, capabilities: TaskCapabilities): TaskNextAction | null {
  if (!item.taskId || item.finalOutcome || !capabilities.canAssign) return null
  return item.assigneeId ? ACTIONS.reassign : ACTIONS.assign
}

/** Active work only: terminal/Done Today records never inflate an assignee's workload hint. */
export function getAssigneeActiveWorkload(items: UnifiedTaskItem[]): Map<string, number> {
  const workload = new Map<string, number>()
  for (const item of items) {
    if (!item.assigneeId || item.displayStatus === 'done' || item.finalOutcome) continue
    workload.set(item.assigneeId, (workload.get(item.assigneeId) ?? 0) + 1)
  }
  return workload
}
