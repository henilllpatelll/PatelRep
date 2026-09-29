import type { Priority } from '@/lib/api/tasks'
import type { UnifiedTaskItem } from './unifiedTasks'

/** Assignment is always written to the backing Task (see taskNextAction.ts) — a
 * selected item with no linked task (an orphan guest request) cannot be assigned. */
export function canBulkAssign(item: UnifiedTaskItem): boolean {
  return !!item.taskId && !item.finalOutcome
}

// Mirrors services/guest_recovery/contracts.py's _ALLOWED_TRANSITIONS: 'cancelled' is
// reachable from every non-terminal guest_request status except resolved/verified.
const GUEST_CANCELLABLE_STATUSES = new Set(['open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'reopened'])

/** Internal tasks can be cancelled unless already terminal. Guest requests can only be
 * cancelled while still in flight — a resolved/verified request must be reopened first,
 * a rule the backend enforces and this never tries to bypass or paper over. */
export function canBulkCancel(item: UnifiedTaskItem): boolean {
  if (item.finalOutcome) return false
  if (item.sourceType === 'internal') return !!item.taskId
  return !!item.guestRequestStatus && GUEST_CANCELLABLE_STATUSES.has(item.guestRequestStatus)
}

export const GUEST_REQUEST_PRIORITIES: Priority[] = ['urgent', 'normal']
export const INTERNAL_TASK_PRIORITIES: Priority[] = ['urgent', 'normal', 'low']

/** Intersection-of-valid-values across the current selection: as soon as any selected
 * item is a guest request, 'low' drops out of the offered options since Guest Request
 * priority has no such value — never silently remap a chosen Low to Normal instead. */
export function bulkPriorityOptions(items: UnifiedTaskItem[]): Priority[] {
  const hasGuestRequest = items.some((item) => item.sourceType === 'guest_request')
  return hasGuestRequest ? GUEST_REQUEST_PRIORITIES : INTERNAL_TASK_PRIORITIES
}

export function canBulkSetPriority(item: UnifiedTaskItem, priority: Priority): boolean {
  if (item.finalOutcome) return false
  if (item.sourceType === 'guest_request') return (GUEST_REQUEST_PRIORITIES as string[]).includes(priority)
  return true
}

export interface BulkEligibilitySplit {
  eligible: UnifiedTaskItem[]
  ineligible: UnifiedTaskItem[]
}

export function splitByEligibility(items: UnifiedTaskItem[], isEligible: (item: UnifiedTaskItem) => boolean): BulkEligibilitySplit {
  const eligible: UnifiedTaskItem[] = []
  const ineligible: UnifiedTaskItem[] = []
  for (const item of items) (isEligible(item) ? eligible : ineligible).push(item)
  return { eligible, ineligible }
}

export interface BulkOperationOutcome {
  succeeded: number
  failed: number
}

/** Never assume every settled call succeeded — a bulk action reports exactly how many
 * of the eligible items actually updated versus failed mid-flight (e.g. a concurrent
 * status change the backend's own state machine then rejected). */
export function summarizeBulkResults(results: PromiseSettledResult<unknown>[]): BulkOperationOutcome {
  let succeeded = 0
  let failed = 0
  for (const result of results) result.status === 'fulfilled' ? succeeded++ : failed++
  return { succeeded, failed }
}
