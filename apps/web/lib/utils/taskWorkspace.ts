import type { Priority } from '@/lib/api/tasks'
import type { UnifiedDisplayStatus, UnifiedSourceType, UnifiedTaskItem } from './unifiedTasks'

export interface TaskWorkspaceFilters {
  search?: string
  priority?: Priority | ''
  assigneeId?: string
  department?: string
  overdueOnly?: boolean
  displayStatus?: UnifiedDisplayStatus | ''
  /** '' = both. Replaces the old separate Guest Requests / Internal tabs. */
  sourceType?: UnifiedSourceType | ''
}

export type TaskQuickFilter = 'mine' | 'unassigned' | 'overdue' | 'verify'

export function toggleTaskQuickFilter(
  filters: Pick<TaskWorkspaceFilters, 'assigneeId' | 'overdueOnly' | 'displayStatus'>,
  quickFilter: TaskQuickFilter,
  currentUserId?: string,
): Pick<TaskWorkspaceFilters, 'assigneeId' | 'overdueOnly' | 'displayStatus'> {
  if (quickFilter === 'mine') {
    if (!currentUserId) return filters
    return { ...filters, assigneeId: filters.assigneeId === currentUserId ? '' : currentUserId }
  }
  if (quickFilter === 'unassigned') return { ...filters, assigneeId: filters.assigneeId === '__unassigned__' ? '' : '__unassigned__' }
  if (quickFilter === 'overdue') return { ...filters, overdueOnly: !filters.overdueOnly }
  return { ...filters, displayStatus: filters.displayStatus === 'verify' ? '' : 'verify' }
}

/** Every field the Tasks search box matches, in order of what a housekeeper/supervisor
 * would actually type: title/description, room/location, who it's assigned to, its
 * category, and — for guest requests — the guest's name and the request's own number
 * (so "request 42" or a guest's name finds it, without exposing anything beyond what's
 * already shown on the card/row). */
function searchableValues(item: UnifiedTaskItem): Array<string | undefined> {
  return [
    item.title,
    item.description,
    item.roomNumber,
    item.locationText,
    item.assigneeName,
    item.department,
    item.guestRequest?.guest_name,
    item.guestRequest ? `#${item.guestRequest.request_number}` : undefined,
  ]
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
    if (filters.displayStatus && item.displayStatus !== filters.displayStatus) return false
    if (!query) return true
    return searchableValues(item).some((value) => value?.toLowerCase().includes(query))
  })
}

export type TaskHistoryGroupKey = 'today' | 'yesterday' | 'this_week' | 'earlier'
export interface TaskHistoryGroup { key: TaskHistoryGroupKey; items: UnifiedTaskItem[] }

// ── Board lanes (Tasks home) ────────────────────────────────────────────────
export type LaneKey = 'new' | 'in_progress' | 'verify' | 'done_today'
export interface Lane { key: LaneKey; items: UnifiedTaskItem[] }
export const PRIMARY_TASK_LANE_KEYS: LaneKey[] = ['new', 'in_progress', 'verify']

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

/** Separates active operational lanes from the compact, post-board completion summary. */
export function splitTaskBoardLanes(lanes: Lane[]): { primary: Lane[]; doneToday: Lane } {
  return {
    primary: PRIMARY_TASK_LANE_KEYS.map((key) => lanes.find((lane) => lane.key === key) ?? { key, items: [] }),
    doneToday: lanes.find((lane) => lane.key === 'done_today') ?? { key: 'done_today', items: [] },
  }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function historyGroupFor(finalAt: string, now: Date): TaskHistoryGroupKey {
  const finalDate = new Date(finalAt)
  const today = startOfLocalDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (finalDate >= today) return 'today'
  if (finalDate >= yesterday) return 'yesterday'

  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  return finalDate >= weekStart ? 'this_week' : 'earlier'
}

/** Groups terminal work with local browser calendar semantics and newest outcomes first. */
export function groupTaskHistoryItems(items: UnifiedTaskItem[], now = new Date()): TaskHistoryGroup[] {
  const groups: Record<TaskHistoryGroupKey, UnifiedTaskItem[]> = {
    today: [], yesterday: [], this_week: [], earlier: [],
  }
  for (const item of items) {
    if (!item.finalOutcome) continue
    const finalAt = item.finalAt ?? item.completedAt ?? item.createdAt
    groups[historyGroupFor(finalAt, now)].push(item)
  }
  return (['today', 'yesterday', 'this_week', 'earlier'] as TaskHistoryGroupKey[])
    .map((key) => ({
      key,
      items: [...groups[key]].sort((a, b) => {
        const aTime = new Date(a.finalAt ?? a.completedAt ?? a.createdAt).getTime()
        const bTime = new Date(b.finalAt ?? b.completedAt ?? b.createdAt).getTime()
        return bTime - aTime
      }),
    }))
    .filter((group) => group.items.length > 0)
}
