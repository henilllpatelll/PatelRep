import type { LogbookEntry, LogbookPriority } from '@/lib/api/logbook'

export interface FollowUpSortable {
  follow_up_at?: string | null
  priority: LogbookPriority
  created_at: string
}

/** Deterministic urgency bucket — explainable ordering rather than an opaque
 * ranking (spec #16): overdue, then important, then has-a-due-time, then none. */
function urgencyBucket(entry: FollowUpSortable, nowMs: number): number {
  const dueAt = entry.follow_up_at ? new Date(entry.follow_up_at).getTime() : null
  if (dueAt !== null && dueAt < nowMs) return 0
  if (entry.priority === 'important') return 1
  if (dueAt !== null) return 2
  return 3
}

export function sortLogbookFollowUps<T extends FollowUpSortable>(entries: T[], now: Date = new Date()): T[] {
  const nowMs = now.getTime()
  return [...entries].sort((a, b) => {
    const bucketDiff = urgencyBucket(a, nowMs) - urgencyBucket(b, nowMs)
    if (bucketDiff !== 0) return bucketDiff

    const aDue = a.follow_up_at ? new Date(a.follow_up_at).getTime() : null
    const bDue = b.follow_up_at ? new Date(b.follow_up_at).getTime() : null
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function isFollowUpOverdue(entry: Pick<LogbookEntry, 'follow_up_at' | 'status'>, now: Date = new Date()): boolean {
  if (entry.status !== 'follow_up' || !entry.follow_up_at) return false
  return new Date(entry.follow_up_at).getTime() < now.getTime()
}

/** Needs-Next-Shift eligibility (spec #15): unresolved follow-up, not archived. */
export function needsNextShift(entry: Pick<LogbookEntry, 'status' | 'archived_at'>): boolean {
  return entry.status === 'follow_up' && !entry.archived_at
}
