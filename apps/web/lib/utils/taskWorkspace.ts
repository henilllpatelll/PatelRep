import type { Priority } from '@/lib/api/tasks'
import type { UnifiedSourceType, UnifiedTaskItem } from './unifiedTasks'

export interface TaskWorkspaceFilters {
  search?: string
  priority?: Priority | ''
  assigneeId?: string
  department?: string
  overdueOnly?: boolean
  /** '' = both. Replaces the old separate Guest Requests / Internal tabs. */
  sourceType?: UnifiedSourceType | ''
}

export function filterTaskItems(items: UnifiedTaskItem[], filters: TaskWorkspaceFilters): UnifiedTaskItem[] {
  const query = filters.search?.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.priority && item.priority !== filters.priority) return false
    if (filters.sourceType && item.sourceType !== filters.sourceType) return false
    if (filters.assigneeId === '__unassigned__' && item.assigneeId) return false
    if (filters.assigneeId && filters.assigneeId !== '__unassigned__' && item.assigneeId !== filters.assigneeId) return false
    if (filters.department && item.department !== filters.department) return false
    if (filters.overdueOnly && !item.slaBreached) return false
    if (!query) return true
    return [item.title, item.roomNumber, item.locationText, item.assigneeName, item.department]
      .some((value) => value?.toLowerCase().includes(query))
  })
}

export type TaskGroupKey = 'overdue' | 'unassigned' | 'due_soon' | 'in_progress' | 'review' | 'other'
export interface TaskGroup { key: TaskGroupKey; items: UnifiedTaskItem[] }

// ── Board lanes (Tasks home) ────────────────────────────────────────────────
export type LaneKey = 'new' | 'in_progress' | 'verify' | 'done_today'
export interface Lane { key: LaneKey; items: UnifiedTaskItem[] }

function isToday(iso: string | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/** Whether an item belongs on the board at all: not done, or done earlier today. */
export function isTaskItemOnBoard(item: UnifiedTaskItem): boolean {
  return item.displayStatus !== 'done' || isToday(item.completedAt)
}

/**
 * Four lanes for the board/table home view: new, in_progress, verify (needs
 * review), and done_today. Items completed on an earlier day are deliberately
 * left off the board — the History tab is where older completions live —
 * so "done" only ever means "done today" here.
 */
export function groupTaskItemsByLane(items: UnifiedTaskItem[]): Lane[] {
  const lanes: Record<LaneKey, UnifiedTaskItem[]> = { new: [], in_progress: [], verify: [], done_today: [] }
  for (const item of items) {
    if (!isTaskItemOnBoard(item)) continue
    if (item.displayStatus === 'done') lanes.done_today.push(item)
    else lanes[item.displayStatus].push(item)
  }
  return (['new', 'in_progress', 'verify', 'done_today'] as LaneKey[]).map((key) => ({ key, items: lanes[key] }))
}

export function groupTaskItems(items: UnifiedTaskItem[]): TaskGroup[] {
  const groups: Record<TaskGroupKey, UnifiedTaskItem[]> = {
    overdue: [], unassigned: [], due_soon: [], in_progress: [], review: [], other: [],
  }
  const soon = Date.now() + 60 * 60 * 1000
  for (const item of items) {
    if (item.slaBreached) groups.overdue.push(item)
    else if (!item.assigneeId && item.displayStatus !== 'done') groups.unassigned.push(item)
    else if (item.displayStatus === 'verify') groups.review.push(item)
    else if (item.displayStatus === 'in_progress') groups.in_progress.push(item)
    else if (item.dueAt && new Date(item.dueAt).getTime() <= soon && item.displayStatus !== 'done') groups.due_soon.push(item)
    else groups.other.push(item)
  }
  return (Object.keys(groups) as TaskGroupKey[])
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0)
}
