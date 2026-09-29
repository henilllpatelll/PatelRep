import type { Priority } from '@/lib/api/tasks'
import type { UnifiedSourceType } from './unifiedTasks'

export type TaskViewTab = 'active' | 'history'
export type TaskBoardMode = 'board' | 'table'
/** '__me__' and '__unassigned__' are portable sentinels — '__me__' resolves against
 * whichever user applies the view, so a saved "My Open Tasks" view means the same
 * thing for every viewer instead of freezing in one person's literal user id. */
export type TaskAssigneeFilter = '' | '__me__' | '__unassigned__' | string

export interface TaskFilterState {
  view: TaskViewTab
  boardMode: TaskBoardMode
  search: string
  priority: Priority | ''
  sourceType: UnifiedSourceType | ''
  assignee: TaskAssigneeFilter
  department: string
  overdueOnly: boolean
  verifyOnly: boolean
}

export const DEFAULT_TASK_FILTER_STATE: TaskFilterState = {
  view: 'active',
  boardMode: 'board',
  search: '',
  priority: '',
  sourceType: '',
  assignee: '',
  department: '',
  overdueOnly: false,
  verifyOnly: false,
}

const VIEW_TABS: TaskViewTab[] = ['active', 'history']
const BOARD_MODES: TaskBoardMode[] = ['board', 'table']
const PRIORITIES: Priority[] = ['urgent', 'normal', 'low']
const SOURCE_TYPES: UnifiedSourceType[] = ['guest_request', 'internal']

/** Resolves the portable '__me__' sentinel to a real id for filtering/display, leaving
 * every other value (including '__unassigned__') untouched. */
export function resolveAssigneeFilter(assignee: TaskAssigneeFilter, currentUserId?: string): string {
  if (assignee === '__me__') return currentUserId ?? ''
  return assignee
}

/** The inverse: what a live assignee filter value should be SAVED as, so "Mine" round-trips
 * as '__me__' instead of freezing today's viewer's literal id into the saved view/URL. */
export function encodeAssigneeFilter(liveAssigneeId: string, currentUserId?: string): TaskAssigneeFilter {
  if (currentUserId && liveAssigneeId === currentUserId) return '__me__'
  return liveAssigneeId
}

// ── URL param encode/decode ──────────────────────────────────────────────────
// Param names are deliberately short and human-writable so a filtered Tasks URL is
// bookmarkable/shareable. `type` and `focus` predate this and keep their exact prior
// meaning/behavior — never remove or repurpose them.

const PARAM_KEYS = {
  view: 'view',
  mode: 'mode',
  search: 'q',
  priority: 'priority',
  sourceType: 'type',
  assignee: 'assignee',
  department: 'department',
  overdue: 'overdue',
  verify: 'verify',
} as const

/** Reads Tasks filter state out of URL search params. Every field falls back to the
 * matching DEFAULT_TASK_FILTER_STATE value on a missing or unrecognized param — a
 * malformed/stale URL can never crash the page or produce an inconsistent state. */
export function decodeTaskFiltersFromParams(params: URLSearchParams): TaskFilterState {
  const view = params.get(PARAM_KEYS.view)
  const mode = params.get(PARAM_KEYS.mode)
  const priority = params.get(PARAM_KEYS.priority)
  const sourceType = params.get(PARAM_KEYS.sourceType)
  const assignee = params.get(PARAM_KEYS.assignee)
  const department = params.get(PARAM_KEYS.department)

  return {
    view: VIEW_TABS.includes(view as TaskViewTab) ? (view as TaskViewTab) : DEFAULT_TASK_FILTER_STATE.view,
    boardMode: BOARD_MODES.includes(mode as TaskBoardMode) ? (mode as TaskBoardMode) : DEFAULT_TASK_FILTER_STATE.boardMode,
    search: params.get(PARAM_KEYS.search) ?? DEFAULT_TASK_FILTER_STATE.search,
    priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : DEFAULT_TASK_FILTER_STATE.priority,
    sourceType: SOURCE_TYPES.includes(sourceType as UnifiedSourceType) ? (sourceType as UnifiedSourceType) : DEFAULT_TASK_FILTER_STATE.sourceType,
    assignee: assignee ?? DEFAULT_TASK_FILTER_STATE.assignee,
    department: department ?? DEFAULT_TASK_FILTER_STATE.department,
    overdueOnly: params.get(PARAM_KEYS.overdue) === '1',
    verifyOnly: params.get(PARAM_KEYS.verify) === '1',
  }
}

/**
 * Merges Tasks filter state onto an existing URLSearchParams, leaving every other
 * param (e.g. `focus`) untouched, and omitting any key that's back at its default so
 * the URL stays clean instead of accumulating redundant params.
 */
export function encodeTaskFiltersToParams(state: TaskFilterState, existing: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(existing)
  const setOrDelete = (key: string, value: string, isDefault: boolean) => {
    if (isDefault || !value) params.delete(key)
    else params.set(key, value)
  }
  setOrDelete(PARAM_KEYS.view, state.view, state.view === DEFAULT_TASK_FILTER_STATE.view)
  setOrDelete(PARAM_KEYS.mode, state.boardMode, state.boardMode === DEFAULT_TASK_FILTER_STATE.boardMode)
  setOrDelete(PARAM_KEYS.search, state.search, state.search === '')
  setOrDelete(PARAM_KEYS.priority, state.priority, state.priority === '')
  setOrDelete(PARAM_KEYS.sourceType, state.sourceType, state.sourceType === '')
  setOrDelete(PARAM_KEYS.assignee, state.assignee, state.assignee === '')
  setOrDelete(PARAM_KEYS.department, state.department, state.department === '')
  setOrDelete(PARAM_KEYS.overdue, state.overdueOnly ? '1' : '', !state.overdueOnly)
  setOrDelete(PARAM_KEYS.verify, state.verifyOnly ? '1' : '', !state.verifyOnly)
  return params
}

// ── Saved views ──────────────────────────────────────────────────────────────

export interface SavedTaskView {
  id: string
  name: string
  isDefault: boolean
  filters: TaskFilterState
  createdAt: string
}

export const SAVED_VIEWS_STORAGE_KEY = 'patelrep-tasks-saved-views'

export function createSavedView(name: string, filters: TaskFilterState, id: string, createdAt: string): SavedTaskView {
  return { id, name: name.trim(), isDefault: false, filters, createdAt }
}

/** Adds a new saved view, or replaces one with the same id (rename/re-save). */
export function upsertSavedView(views: SavedTaskView[], view: SavedTaskView): SavedTaskView[] {
  const index = views.findIndex((v) => v.id === view.id)
  if (index === -1) return [...views, view]
  return views.map((v, i) => (i === index ? view : v))
}

export function deleteSavedView(views: SavedTaskView[], id: string): SavedTaskView[] {
  return views.filter((v) => v.id !== id)
}

export function renameSavedView(views: SavedTaskView[], id: string, name: string): SavedTaskView[] {
  const trimmed = name.trim()
  if (!trimmed) return views
  return views.map((v) => (v.id === id ? { ...v, name: trimmed } : v))
}

/** Exactly one default at a time — setting one clears any previous default. */
export function setDefaultSavedView(views: SavedTaskView[], id: string | null): SavedTaskView[] {
  return views.map((v) => ({ ...v, isDefault: v.id === id }))
}

export function getDefaultSavedView(views: SavedTaskView[]): SavedTaskView | undefined {
  return views.find((v) => v.isDefault)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSavedFilters(value: unknown): TaskFilterState {
  if (!isPlainObject(value)) return DEFAULT_TASK_FILTER_STATE
  const params = new URLSearchParams()
  if (typeof value.view === 'string') params.set(PARAM_KEYS.view, value.view)
  if (typeof value.boardMode === 'string') params.set(PARAM_KEYS.mode, value.boardMode)
  if (typeof value.search === 'string') params.set(PARAM_KEYS.search, value.search)
  if (typeof value.priority === 'string') params.set(PARAM_KEYS.priority, value.priority)
  if (typeof value.sourceType === 'string') params.set(PARAM_KEYS.sourceType, value.sourceType)
  if (typeof value.assignee === 'string') params.set(PARAM_KEYS.assignee, value.assignee)
  if (typeof value.department === 'string') params.set(PARAM_KEYS.department, value.department)
  if (value.overdueOnly === true) params.set(PARAM_KEYS.overdue, '1')
  if (value.verifyOnly === true) params.set(PARAM_KEYS.verify, '1')
  return decodeTaskFiltersFromParams(params)
}

/** Defends against corrupted/hand-edited localStorage content — never throws, and any
 * view whose shape doesn't check out is dropped rather than crashing the whole list. */
export function parseSavedViewsJson(raw: string | null): SavedTaskView[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Record<string, unknown> =>
        isPlainObject(entry) && typeof entry.id === 'string' && typeof entry.name === 'string')
      .map((entry) => ({
        id: entry.id as string,
        name: entry.name as string,
        isDefault: entry.isDefault === true,
        filters: normalizeSavedFilters(entry.filters),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      }))
  } catch {
    return []
  }
}
