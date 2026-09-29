'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ClipboardList, Clock, Search, SlidersHorizontal, LayoutGrid, Rows3, X, Keyboard } from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type Priority, type CreateTaskData } from '@/lib/api/tasks'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { PageHeader } from '@/components/shared/PageHeader'
import { StateBlock } from '@/components/ui/StateBlock'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { Pill, Mono } from '@/components/ui/primitives'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { GuestRequestDrawer } from '@/components/guest-requests/GuestRequestDrawer'
import { CreateTaskDrawer } from '@/components/tasks/CreateTaskDrawer'
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer'
import { UnifiedTaskRow } from '@/components/tasks/UnifiedTaskRow'
import { buildUnifiedTaskItems, sortUnifiedItems, type UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { getTaskCapabilities } from '@/lib/utils/taskCapabilities'
import { getAssigneeActiveWorkload, type TaskNextActionKey } from '@/lib/utils/taskNextAction'
import { filterTaskItems, groupTaskHistoryItems, groupTaskItemsByLane, isTaskItemOnBoard, toggleTaskQuickFilter, type TaskQuickFilter } from '@/lib/utils/taskWorkspace'
import { TasksBoardView } from '@/components/tasks/TasksBoardView'
import { TasksTableView } from '@/components/tasks/TasksTableView'
import { SavedViewsMenu } from '@/components/tasks/SavedViewsMenu'
import { BulkActionBar } from '@/components/tasks/BulkActionBar'
import type { TaskNextActionContext } from '@/components/tasks/TaskNextAction'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import {
  createSavedView,
  decodeTaskFiltersFromParams,
  encodeAssigneeFilter,
  encodeTaskFiltersToParams,
  getDefaultSavedView,
  parseSavedViewsJson,
  resolveAssigneeFilter,
  setDefaultSavedView,
  deleteSavedView,
  renameSavedView,
  type SavedTaskView,
  type TaskFilterState,
  SAVED_VIEWS_STORAGE_KEY,
} from '@/lib/utils/taskViews'
import { summarizeBulkResults } from '@/lib/utils/taskBulkActions'

// Guest Requests / Internal / Verify tabs were folded away: Verify is now a
// lane on the board, and Guest/Internal became the Type filter below (source
// type param, ?type=guest_request|internal) instead of separate tabs.
type ViewTab = 'active' | 'history'
const VIEW_TABS: ViewTab[] = ['active', 'history']
type BoardMode = 'board' | 'table'
type SourceTypeFilter = UnifiedTaskItem['sourceType'] | ''
const GUEST_TRANSITIONS: Partial<Record<TaskNextActionKey, Exclude<GuestRequest['status'], 'open'>>> = {
  acknowledge: 'acknowledged', dispatch: 'dispatched', arrived: 'arrived', guest_contacted: 'guest_contacted', resolve: 'resolved', verify: 'verified',
}
const ACTION_TO_TOAST: Partial<Record<TaskNextActionKey, string>> = {
  claim: 'tasks.toast.claimed', start: 'tasks.toast.started', complete: 'tasks.toast.completed',
  acknowledge: 'tasks.toast.acknowledged', dispatch: 'tasks.toast.dispatched', arrived: 'tasks.toast.arrived',
  guest_contacted: 'tasks.toast.guestContacted', resolve: 'tasks.toast.resolved', verify: 'tasks.toast.verified',
}

// "Active" is the board: new + in_progress + verify + anything completed earlier
// today. Older completions live in History — see isTaskItemOnBoard.
function bucketFor(view: ViewTab, item: UnifiedTaskItem): boolean {
  switch (view) {
    case 'active': return isTaskItemOnBoard(item)
    case 'history': return !!item.finalOutcome
  }
}

function TasksPageContent() {
  const { t } = useTranslation()
  const { role } = useRole()
  const toast = useToast()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialFiltersRef = useRef(decodeTaskFiltersFromParams(new URLSearchParams(searchParams.toString())))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shortcutDialogRef = useRef<HTMLDivElement>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useModalFocusTrap(shortcutDialogRef, shortcutsOpen, () => setShortcutsOpen(false))

  const [view, setView] = useState<ViewTab>(initialFiltersRef.current.view)
  const [boardMode, setBoardMode] = useState<BoardMode>(initialFiltersRef.current.boardMode)
  function changeBoardMode(mode: BoardMode) {
    setBoardMode(mode)
  }
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>(initialFiltersRef.current.priority)
  // Seeded from ?type= so external "view guest requests" links (housekeeping page,
  // CommandPalette, the legacy /guest-requests redirect) still land pre-filtered.
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>(initialFiltersRef.current.sourceType)
  const [assigneeFilter, setAssigneeFilter] = useState(initialFiltersRef.current.assignee)
  const [overdueOnly, setOverdueOnly] = useState(initialFiltersRef.current.overdueOnly)
  const [departmentFilter, setDepartmentFilter] = useState(initialFiltersRef.current.department)
  const [verifyOnly, setVerifyOnly] = useState(initialFiltersRef.current.verifyOnly)
  const [search, setSearch] = useState(initialFiltersRef.current.search)
  const [savedViews, setSavedViews] = useState<SavedTaskView[]>([])
  const [savedViewsLoaded, setSavedViewsLoaded] = useState(false)
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  function applyFilterState(next: TaskFilterState) {
    setView(next.view)
    setBoardMode(next.boardMode)
    setSearch(next.search)
    setPriorityFilter(next.priority)
    setSourceTypeFilter(next.sourceType)
    setAssigneeFilter(resolveAssigneeFilter(next.assignee, currentUserId))
    setDepartmentFilter(next.department)
    setOverdueOnly(next.overdueOnly)
    setVerifyOnly(next.verifyOnly)
  }

  const currentFilterState = useMemo<TaskFilterState>(() => ({
    view,
    boardMode,
    search,
    priority: priorityFilter,
    sourceType: sourceTypeFilter,
    assignee: encodeAssigneeFilter(assigneeFilter, currentUserId),
    department: departmentFilter,
    overdueOnly,
    verifyOnly,
  }), [view, boardMode, search, priorityFilter, sourceTypeFilter, assigneeFilter, currentUserId, departmentFilter, overdueOnly, verifyOnly])

  useEffect(() => {
    applyFilterState(decodeTaskFiltersFromParams(new URLSearchParams(searchParams.toString())))
  // searchParams is the source of truth for direct navigation and Back/Forward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, currentUserId])

  useEffect(() => {
    const params = encodeTaskFiltersToParams(currentFilterState, new URLSearchParams(searchParams.toString()))
    if (params.toString() !== searchParams.toString()) router.replace(`?${params.toString()}`, { scroll: false })
  }, [currentFilterState, router, searchParams])

  useEffect(() => {
    try {
      const views = parseSavedViewsJson(window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY))
      setSavedViews(views)
      const defaultView = getDefaultSavedView(views)
      if (defaultView && searchParams.toString() === '') {
        applyFilterState(defaultView.filters)
        setActiveSavedViewId(defaultView.id)
      }
    } finally {
      setSavedViewsLoaded(true)
    }
  // Load once; later mutations are persisted by the next effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!savedViewsLoaded) return
    try { window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews)) } catch { /* Storage is optional in private browsing. */ }
  }, [savedViews, savedViewsLoaded])

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    )
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') { event.preventDefault(); searchInputRef.current?.focus(); return }
      if (event.key.toLowerCase() === 'c' && capabilities.canCreate) { event.preventDefault(); openCreateDrawer(); return }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); setView('active'); changeBoardMode('board'); return }
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); setView('active'); changeBoardMode('table'); return }
      if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [role])

  const [showCreateDrawer, setShowCreateDrawer] = useState(false)
  function openCreateDrawer() { setShowCreateDrawer(true) }

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerEditMode, setDrawerEditMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [selectedGuestRequest, setSelectedGuestRequest] = useState<GuestRequest | null>(null)
  const [pendingInlineAction, setPendingInlineAction] = useState<{ itemId: string; key: TaskNextActionKey } | null>(null)

  const appliedFocusRef = useRef<string | null>(null)

  function handleTabChange(tab: ViewTab) {
    setView(tab)
  }

  function invalidateAll() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'workspace'] }),
      queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] }),
    ])
  }

  const historySearch = view === 'history' ? search.trim() || undefined : undefined
  const { data: workspaceResponse, isLoading, isError, refetch: refetchWorkspace } = useQuery({
    queryKey: ['tasks', 'workspace', { historySearch }],
    queryFn: () => tasksApi.workspace({ history_search: historySearch }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
  const tasks: Task[] = useMemo(() => {
    const workspace = workspaceResponse?.data
    return workspace ? [...workspace.active.tasks, ...workspace.history.tasks] : []
  }, [workspaceResponse])
  const guestRequests: GuestRequest[] = useMemo(() => {
    const workspace = workspaceResponse?.data
    return workspace ? [...workspace.active.guest_requests, ...workspace.history.guest_requests] : []
  }, [workspaceResponse])

  const capabilities = getTaskCapabilities(role)
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    enabled: capabilities.canAssign || capabilities.canUseAssigneeFilter,
    select: (res) => (res.data as { staff: StaffMember[] }).staff.filter(s => s.status === 'active'),
  })
  const staffList = useMemo(() => staffData ?? [], [staffData])

  const allItems = useMemo(() => {
    const names = new Map(staffList.map((member) => [member.user_id, member.full_name]))
    return sortUnifiedItems(buildUnifiedTaskItems(tasks, guestRequests)).map((item) => ({
      ...item,
      assigneeName: item.assigneeName ?? (item.assigneeId ? names.get(item.assigneeId) : undefined),
    }))
  }, [tasks, guestRequests, staffList])

  // Keep any open drawer's snapshot in sync with the latest fetch — a stale drawer
  // re-sending an already-applied transition/status gets rejected by the backend
  // state machine (see .wolf/buglog.json).
  useEffect(() => {
    if (!selectedGuestRequest) return
    const fresh = guestRequests.find(r => r.id === selectedGuestRequest.id)
    if (fresh && fresh !== selectedGuestRequest) setSelectedGuestRequest(fresh)
  }, [guestRequests, selectedGuestRequest])

  useEffect(() => {
    if (!selectedTask) return
    const fresh = tasks.find(tk => tk.id === selectedTask.id)
    if (fresh && fresh !== selectedTask) setSelectedTask(fresh)
  }, [tasks, selectedTask])

  const selectedUnifiedItem = useMemo(
    () => (selectedTask ? allItems.find((item) => item.taskId === selectedTask.id) ?? null : null),
    [allItems, selectedTask],
  )

  // Deep link: ?type=guest_request&focus=<guestRequestId> — this is also what the
  // legacy /guest-requests?focus=<id> redirect forwards into. The drawer opens on
  // `focus` alone, independent of the active tab/type filter.
  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId || appliedFocusRef.current === focusId) return
    const target = guestRequests.find(r => r.id === focusId)
    if (!target) return // graceful no-op: deleted/stale/cross-tenant id
    appliedFocusRef.current = focusId
    setSelectedGuestRequest(target)
  }, [searchParams, guestRequests])

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<GuestRequest['status'], 'open'> }) =>
      guestRequestsApi.transitionRequest(id, { status }),
    onSuccess: invalidateAll,
  })
  const handleAdvance = (id: string, status: Exclude<GuestRequest['status'], 'open'>) =>
    transitionMutation.mutate({ id, status })

  const { mutateAsync: createTask, isPending: creatingTask } = useMutation({
    mutationFn: (data: CreateTaskData) => tasksApi.create(data),
    onSuccess: invalidateAll,
  })

  const { mutate: updateTaskStatus, isPending: updatingTask } = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => tasksApi.update(taskId, { status }),
    onSuccess: (_res, variables) => {
      invalidateAll()
      setSelectedTask((prev) => (prev && prev.id === variables.taskId ? { ...prev, status: variables.status } : prev))
    },
  })

  async function runInlineAction(item: UnifiedTaskItem, key: TaskNextActionKey, note?: string) {
    setPendingInlineAction({ itemId: item.id, key })
    try {
      let response: any
      if (key === 'claim') {
        if (!item.taskId) return
        response = await tasksApi.claim(item.taskId)
      } else if (key === 'start' || key === 'complete') {
        if (!item.taskId) return
        response = await tasksApi.update(item.taskId, { status: key === 'start' ? 'in_progress' : 'completed', notes: note })
      } else {
        const status = GUEST_TRANSITIONS[key]
        if (!status || !item.guestRequestId) return
        response = await guestRequestsApi.transitionRequest(item.guestRequestId, { status })
      }
      if (item.sourceType === 'internal' && response?.data) setSelectedTask((current) => current?.id === item.taskId ? response.data : current)
      if (item.sourceType === 'guest_request' && response?.data) setSelectedGuestRequest((current) => current?.id === item.guestRequestId ? response.data : current)
      toast.success(t(ACTION_TO_TOAST[key] ?? 'tasks.toast.updated'))
      await invalidateAll()
    } catch (error: any) {
      await invalidateAll()
      const status = error?.response?.status ?? error?.status
      toast.error(status === 409 || status === 422 ? t('tasks.toast.latestStatusLoaded') : t('tasks.toast.actionFailed'))
    } finally {
      setPendingInlineAction(null)
    }
  }

  async function assignInline(item: UnifiedTaskItem, staff: StaffMember) {
    if (!item.taskId) return
    const key: TaskNextActionKey = item.assigneeId ? 'reassign' : 'assign'
    setPendingInlineAction({ itemId: item.id, key })
    try {
      const response: any = await tasksApi.update(item.taskId, { assigned_to: staff.user_id })
      setSelectedTask((current) => current?.id === item.taskId && response?.data ? response.data : current)
      toast.success(t('tasks.toast.assignedTo', { name: staff.full_name }))
      await invalidateAll()
    } catch {
      await invalidateAll()
      toast.error(t('tasks.toast.actionFailed'))
    } finally {
      setPendingInlineAction(null)
    }
  }

  const { mutate: deleteTask, isPending: deleting } = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => { invalidateAll(); setDeleteTarget(null); setSelectedTask(null) },
  })

  function toggleItemSelection(item: UnifiedTaskItem) {
    setSelectedItemIds((previous) => {
      const next = new Set(previous)
      next.has(item.id) ? next.delete(item.id) : next.add(item.id)
      return next
    })
  }

  function selectVisibleItems(items: UnifiedTaskItem[]) {
    setSelectedItemIds((previous) => new Set([...previous, ...items.map((item) => item.id)]))
  }

  async function runBulkUpdate(
    items: UnifiedTaskItem[],
    operation: (item: UnifiedTaskItem) => Promise<unknown>,
  ) {
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(items.map(operation))
      const outcome = summarizeBulkResults(results)
      const failedIds = new Set(
        results.flatMap((result, index) => result.status === 'rejected' ? [items[index].id] : []),
      )
      setSelectedItemIds(failedIds)
      await invalidateAll()
      if (outcome.failed) toast.error(t('tasks.bulk.resultPartial', { succeeded: outcome.succeeded, failed: outcome.failed }))
      else toast.success(t('tasks.bulk.resultSuccess', { succeeded: outcome.succeeded }))
    } finally {
      setBulkBusy(false)
    }
  }

  function bulkAssign(staff: StaffMember, items: UnifiedTaskItem[]) {
    void runBulkUpdate(items, (item) => tasksApi.update(item.taskId!, { assigned_to: staff.user_id }))
  }

  function bulkSetPriority(priority: Priority, items: UnifiedTaskItem[]) {
    void runBulkUpdate(items, (item) => (
      item.sourceType === 'guest_request'
        ? guestRequestsApi.updateRequest(item.guestRequestId!, { priority: priority as GuestRequest['priority'] })
        : tasksApi.update(item.taskId!, { priority })
    ))
  }

  function bulkCancel(items: UnifiedTaskItem[]) {
    void runBulkUpdate(items, (item) => (
      item.sourceType === 'guest_request'
        ? guestRequestsApi.transitionRequest(item.guestRequestId!, { status: 'cancelled' })
        : tasksApi.update(item.taskId!, { status: 'cancelled' })
    ))
  }

  const handleComment = async (taskId: string, comment: string) => {
    await tasksApi.addComment(taskId, comment)
    invalidateAll()
    const res = (await tasksApi.get(taskId)) as any
    if (res?.data) setSelectedTask(res.data)
  }

  function openItem(item: UnifiedTaskItem) {
    if (item.sourceType === 'guest_request' && item.guestRequest) {
      setDrawerEditMode(false)
      setSelectedGuestRequest(item.guestRequest)
    } else if (item.task) {
      setDrawerEditMode(false)
      setSelectedTask(item.task)
    }
  }
  function editInternalItem(item: UnifiedTaskItem) {
    if (item.task) { setDrawerEditMode(true); setSelectedTask(item.task) }
  }
  function deleteInternalItem(item: UnifiedTaskItem) {
    if (item.task) setDeleteTarget(item.task)
  }

  const tabItems = useMemo(() => allItems.filter((item) => bucketFor(view, item)), [allItems, view])

  const filteredItems = useMemo(() => filterTaskItems(tabItems, { search, priority: priorityFilter, sourceType: sourceTypeFilter, assigneeId: assigneeFilter, department: departmentFilter, overdueOnly, displayStatus: verifyOnly ? 'verify' : '' }), [tabItems, priorityFilter, sourceTypeFilter, assigneeFilter, departmentFilter, overdueOnly, verifyOnly, search])
  const groupedItems = useMemo(() => groupTaskHistoryItems(filteredItems), [filteredItems])
  const lanes = useMemo(() => groupTaskItemsByLane(filteredItems), [filteredItems])
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedItemIds.has(item.id)),
    [filteredItems, selectedItemIds],
  )

  const activeItems = useMemo(() => allItems.filter((item) => bucketFor('active', item)), [allItems])
  const workloadByAssignee = useMemo(() => getAssigneeActiveWorkload(activeItems), [activeItems])
  const actionContext: TaskNextActionContext = {
    capabilities,
    role,
    staff: staffList,
    workloadByAssignee,
    pendingAction: pendingInlineAction,
    onAction: runInlineAction,
    onAssign: assignInline,
  }
  const overdueCount = activeItems.filter(i => i.slaBreached).length
  const urgentCount = activeItems.filter(i => i.priority === 'urgent' && i.displayStatus !== 'done').length
  const quickCounts = useMemo(() => ({
    mine: currentUserId ? activeItems.filter((item) => item.assigneeId === currentUserId).length : 0,
    unassigned: activeItems.filter((item) => !item.assigneeId).length,
    overdue: activeItems.filter((item) => item.slaBreached).length,
    verify: activeItems.filter((item) => item.displayStatus === 'verify').length,
  }), [activeItems, currentUserId])
  const advancedFilterCount = Number(!!priorityFilter) + Number(!!sourceTypeFilter) + Number(!!departmentFilter) + Number(!!assigneeFilter && assigneeFilter !== currentUserId && assigneeFilter !== '__unassigned__')
  const mineActive = !!currentUserId && assigneeFilter === currentUserId
  const unassignedActive = assigneeFilter === '__unassigned__'

  useEffect(() => {
    setSelectedItemIds((previous) => {
      const visibleIds = new Set(filteredItems.map((item) => item.id))
      const next = new Set([...previous].filter((id) => visibleIds.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [filteredItems])

  useEffect(() => {
    const active = savedViews.find((saved) => saved.id === activeSavedViewId)
    if (active && JSON.stringify(active.filters) !== JSON.stringify(currentFilterState)) setActiveSavedViewId(null)
  }, [savedViews, activeSavedViewId, currentFilterState])

  function saveCurrentView(name: string) {
    const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `task-view-${Date.now()}`
    const saved = createSavedView(name, currentFilterState, id, new Date().toISOString())
    setSavedViews((previous) => [...previous, saved])
    setActiveSavedViewId(id)
    toast.success(t('tasks.views.saved'))
  }

  function applySavedView(saved: SavedTaskView) {
    applyFilterState(saved.filters)
    setActiveSavedViewId(saved.id)
    setSelectedItemIds(new Set())
  }

  function clearAllFilters() {
    setPriorityFilter('')
    setSourceTypeFilter('')
    setAssigneeFilter('')
    setDepartmentFilter('')
    setOverdueOnly(false)
    setVerifyOnly(false)
    setActiveSavedViewId(null)
  }

  function toggleQuickFilter(quickFilter: TaskQuickFilter) {
    const next = toggleTaskQuickFilter({ assigneeId: assigneeFilter, overdueOnly, displayStatus: verifyOnly ? 'verify' : '' }, quickFilter, currentUserId)
    setAssigneeFilter(next.assigneeId ?? '')
    setOverdueOnly(!!next.overdueOnly)
    setVerifyOnly(next.displayStatus === 'verify')
  }

  const tabCounts: Record<ViewTab, number> = {
    active: allItems.filter(i => bucketFor('active', i)).length,
    history: allItems.filter(i => bucketFor('history', i)).length,
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <PageHeader
          eyebrow={t('tasks.unified.eyebrow')}
          title={t('tasks.unified.title')}
          meta={
            <>
              {overdueCount > 0 && (
              <button type="button" aria-pressed={overdueOnly} onClick={() => setOverdueOnly((active) => !active)} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Pill tone="alert" size="sm"><Clock size={9} /> <Mono>{overdueCount}</Mono> {t('tasks.overdueLabel')}</Pill></button>
              )}
              {urgentCount > 0 && (
              <button type="button" aria-pressed={priorityFilter === 'urgent'} onClick={() => setPriorityFilter((priority) => priority === 'urgent' ? '' : 'urgent')} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Pill tone="alert" size="sm"><Mono>{urgentCount}</Mono> {t('tasks.urgentLabel')}</Pill></button>
              )}
            </>
          }
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SavedViewsMenu
                views={savedViews}
                activeViewId={activeSavedViewId}
                onApply={applySavedView}
                onSaveCurrent={saveCurrentView}
                onRename={(id, name) => setSavedViews((previous) => renameSavedView(previous, id, name))}
                onDelete={(id) => {
                  setSavedViews((previous) => deleteSavedView(previous, id))
                  if (activeSavedViewId === id) setActiveSavedViewId(null)
                }}
                onSetDefault={(id) => setSavedViews((previous) => setDefaultSavedView(previous, id))}
              />
              {capabilities.canCreate && (
                <Button variant="primary" onClick={() => openCreateDrawer()} className="gap-1.5 shrink-0">
                  <Plus size={15} />{t('tasks.unified.newTaskButton')}
                </Button>
              )}
            </div>
          }
          tabs={VIEW_TABS.map((tab) => ({
            label: t(`tasks.unified.tabs.${tab}`),
            count: tabCounts[tab],
            active: view === tab,
            onClick: () => handleTabChange(tab),
          }))}
        />
      </div>

      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" /><input
          ref={searchInputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tasks.unified.searchPlaceholder')}
          aria-label={t('tasks.unified.searchPlaceholder')}
          className="w-full border border-[var(--line)] rounded-lg py-2.5 pl-9 pr-9 text-sm bg-surface text-ink2 placeholder:text-ink4 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        />{search && <button type="button" onClick={() => setSearch('')} aria-label={t('tasks.workspace.clearSearchAria')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink3 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={15} /></button>}</div>
        <details className="relative"><summary className="list-none cursor-pointer rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink2"><SlidersHorizontal className="mr-1 inline" size={15}/>{t('tasks.workspace.filters')}</summary><div className="absolute right-0 z-20 mt-2 w-64 rounded-[var(--r-md)] border border-line bg-surface p-3 shadow-card"><p className="mb-2 text-xs font-semibold text-ink3">{t('tasks.createModal.typeLabel')}</p><div className="flex flex-wrap gap-1"><button type="button" onClick={() => setSourceTypeFilter('')} className={`rounded px-2 py-1 text-xs ${sourceTypeFilter === '' ? 'bg-[var(--accent-soft)] text-accent' : 'bg-surface-2 text-ink3'}`}>{t('tasks.allTypesOption')}</button><button type="button" onClick={() => setSourceTypeFilter(sourceTypeFilter === 'guest_request' ? '' : 'guest_request')} className={`rounded px-2 py-1 text-xs ${sourceTypeFilter === 'guest_request' ? 'bg-[var(--accent-soft)] text-accent' : 'bg-surface-2 text-ink3'}`}>{t('tasks.unified.chooserGuestTitle')}</button><button type="button" onClick={() => setSourceTypeFilter(sourceTypeFilter === 'internal' ? '' : 'internal')} className={`rounded px-2 py-1 text-xs ${sourceTypeFilter === 'internal' ? 'bg-[var(--accent-soft)] text-accent' : 'bg-surface-2 text-ink3'}`}>{t('tasks.unified.chooserInternalTitle')}</button></div><p className="mb-2 mt-3 text-xs font-semibold text-ink3">{t('tasks.filterPriorityAria')}</p><div className="flex flex-wrap gap-1">{(['urgent','normal','low'] as Priority[]).map((priority) => <button type="button" key={priority} onClick={() => setPriorityFilter(priorityFilter === priority ? '' : priority)} className={`rounded px-2 py-1 text-xs ${priorityFilter === priority ? 'bg-[var(--accent-soft)] text-accent' : 'bg-surface-2 text-ink3'}`}>{t(`tasks.priorities.${priority}`)}</button>)}</div><div className="mt-3 flex flex-wrap gap-1"><button type="button" onClick={() => setOverdueOnly((v) => !v)} aria-pressed={overdueOnly} className={`rounded px-2 py-1 text-xs ${overdueOnly ? 'bg-[var(--alert-soft)] text-[var(--alert)]' : 'bg-surface-2 text-ink3'}`}>{t('tasks.board.overdueChip')}</button></div>{capabilities.canUseAssigneeFilter && staffList.length > 0 && <><p className="mb-2 mt-3 text-xs font-semibold text-ink3">{t('tasks.detail.assignedTo')}</p><div className="max-h-32 space-y-1 overflow-y-auto"><button type="button" onClick={() => setAssigneeFilter('')} className="block text-left text-xs text-ink3">{t('tasks.unified.allAssigneesOption')}</button>{staffList.map((s) => <button type="button" key={s.user_id} onClick={() => setAssigneeFilter(s.user_id)} className="block text-left text-xs text-ink2">{s.full_name}</button>)}</div></>}<button type="button" onClick={() => { setPriorityFilter(''); setSourceTypeFilter(''); setAssigneeFilter(''); setDepartmentFilter(''); setOverdueOnly(false) }} className="mt-3 text-xs font-medium text-accent">{t('tasks.workspace.clearFilters')}</button></div></details>
        {view === 'active' && (
          <div role="group" aria-label={t('tasks.board.viewToggleAria')} className="flex shrink-0 rounded-[var(--r-md)] border border-line bg-surface-2 p-[3px]">
            <button type="button" onClick={() => changeBoardMode('board')} aria-pressed={boardMode === 'board'} className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${boardMode === 'board' ? 'bg-surface text-ink shadow-sm' : 'text-ink3'}`}>
              <LayoutGrid size={13} />{t('tasks.board.viewBoard')}
            </button>
            <button type="button" onClick={() => changeBoardMode('table')} aria-pressed={boardMode === 'table'} className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${boardMode === 'table' ? 'bg-surface text-ink shadow-sm' : 'text-ink3'}`}>
              <Rows3 size={13} />{t('tasks.board.viewTable')}
            </button>
          </div>
        )}
        <button type="button" onClick={() => setShortcutsOpen(true)} aria-label={t('tasks.shortcuts.openAria')} className="rounded-lg border border-line p-2.5 text-ink3 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Keyboard size={15} /></button>
      </div>

      {/* List — this region fills the rest of the viewport and owns its own scroll,
          so the page itself never grows past the viewport. On wide screens the board
          (TasksBoardView) fills this region exactly and each lane scrolls on its own;
          this wrapper's overflow-y-auto is the fallback for narrower layouts where a
          lane's natural height exceeds the region. */}
      {view === 'active' && (
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {currentUserId && <button type="button" aria-pressed={mineActive} onClick={() => toggleQuickFilter('mine')} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${mineActive ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{t('tasks.board.quickFilters.mine', { count: quickCounts.mine })}</button>}
          <button type="button" aria-pressed={unassignedActive} onClick={() => toggleQuickFilter('unassigned')} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${unassignedActive ? 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{t('tasks.board.quickFilters.unassigned', { count: quickCounts.unassigned })}</button>
          <button type="button" aria-pressed={overdueOnly} onClick={() => toggleQuickFilter('overdue')} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${overdueOnly ? 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{t('tasks.board.quickFilters.overdue', { count: quickCounts.overdue })}</button>
          <button type="button" aria-pressed={verifyOnly} onClick={() => toggleQuickFilter('verify')} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${verifyOnly ? 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{t('tasks.board.quickFilters.verify', { count: quickCounts.verify })}</button>
        </div>
      )}

      {advancedFilterCount > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 text-xs">
          {priorityFilter && <button type="button" onClick={() => setPriorityFilter('')} className="rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{t(`tasks.priorities.${priorityFilter}`)} ×</button>}
          {sourceTypeFilter && <button type="button" onClick={() => setSourceTypeFilter('')} className="rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{t(sourceTypeFilter === 'guest_request' ? 'tasks.board.sourceGuest' : 'tasks.board.sourceInternal')} ×</button>}
          {assigneeFilter && !mineActive && !unassignedActive && <button type="button" onClick={() => setAssigneeFilter('')} className="rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{staffList.find((staff) => staff.user_id === assigneeFilter)?.full_name ?? t('tasks.detail.assignedTo')} ×</button>}
          {departmentFilter && <button type="button" onClick={() => setDepartmentFilter('')} className="rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{departmentFilter} ×</button>}
          <button type="button" onClick={clearAllFilters} className="px-1.5 py-1 font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{t('tasks.workspace.clearFilters')}</button>
        </div>
      )}

      {view === 'active' && boardMode === 'table' && selectedItems.length > 0 && (
        <BulkActionBar
          selectedItems={selectedItems}
          staff={staffList}
          workloadByAssignee={workloadByAssignee}
          canAssign={capabilities.canAssign}
          canManage={capabilities.canEdit}
          onAssign={bulkAssign}
          onSetPriority={bulkSetPriority}
          onCancel={bulkCancel}
          onClear={() => setSelectedItemIds(new Set())}
          busy={bulkBusy}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[42px] bg-surface-2 border border-line-2 rounded-[var(--r-md)] animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <StateBlock status="error" error={{ message: t('tasks.loadError'), onRetry: () => { refetchWorkspace() } }} />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <StateBlock
              status="empty"
              empty={{
                icon: <ClipboardList size={20} />,
                title: t('tasks.empty.title'),
                body: t('tasks.empty.subtitle'),
                action: capabilities.canCreate ? (
                  <Button variant="primary" onClick={() => openCreateDrawer()} className="gap-1.5">
                    <Plus size={14} />{t('tasks.empty.button')}
                  </Button>
                ) : undefined,
              }}
            />
          </div>
        ) : view === 'active' && boardMode === 'board' ? (
          <TasksBoardView lanes={lanes} onOpen={openItem} actionContext={actionContext} />
        ) : view === 'active' && boardMode === 'table' ? (
          <TasksTableView
            lanes={lanes}
            onOpen={openItem}
            onEdit={capabilities.canEdit ? editInternalItem : undefined}
            onDelete={capabilities.canDelete ? deleteInternalItem : undefined}
            showActions={capabilities.canEdit || capabilities.canDelete}
            actionContext={actionContext}
            selection={{
              selectedIds: selectedItemIds,
              onToggle: toggleItemSelection,
              onSelectAllVisible: selectVisibleItems,
              onClear: () => setSelectedItemIds(new Set()),
            }}
          />
        ) : (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            {groupedItems.map((group) => <div key={group.key}><p className="border-b border-line bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-[.1em] text-ink3">{t(`tasks.workspace.groups.${group.key}`)}</p>{group.items.map((item) => <UnifiedTaskRow key={item.id} item={item} onOpen={openItem} onEdit={capabilities.canEdit && item.sourceType === 'internal' ? editInternalItem : undefined} onDelete={capabilities.canDelete && item.sourceType === 'internal' ? deleteInternalItem : undefined} showActions={capabilities.canEdit || capabilities.canDelete} actionContext={actionContext} />)}</div>)}
          </div>
        )}
      </div>

      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div ref={shortcutDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tasks-shortcuts-title" className="w-full max-w-sm rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-pop">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="tasks-shortcuts-title" className="text-base font-semibold text-ink">{t('tasks.shortcuts.title')}</h2><p className="mt-1 text-sm text-ink3">{t('tasks.shortcuts.description')}</p></div>
              <button type="button" onClick={() => setShortcutsOpen(false)} aria-label={t('tasks.shortcuts.closeAria')} className="rounded p-1 text-ink3 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={17} /></button>
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              {[['C', 'create'], ['/', 'search'], ['B', 'board'], ['L', 'list'], ['Esc', 'close']].map(([key, label]) => <div key={label} className="flex items-center justify-between gap-4"><dt className="text-ink2">{t(`tasks.shortcuts.${label}`)}</dt><dd><kbd className="rounded border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink">{key}</kbd></dd></div>)}
            </dl>
          </div>
        </div>
      )}

      <CreateTaskDrawer
        isOpen={showCreateDrawer}
        onClose={() => setShowCreateDrawer(false)}
        onCreateTask={createTask}
        onCreated={invalidateAll}
        staff={staffList}
        canAssign={capabilities.canAssign}
        creating={creatingTask}
        initialMode={sourceTypeFilter === 'guest_request' ? 'guest' : sourceTypeFilter === 'internal' ? 'internal' : undefined}
      />

      <GuestRequestDrawer
        request={selectedGuestRequest}
        isOpen={!!selectedGuestRequest}
        onClose={() => setSelectedGuestRequest(null)}
        onNoteAdded={invalidateAll}
        onAdvance={handleAdvance}
        isUpdating={transitionMutation.isPending}
      />

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          item={selectedUnifiedItem}
          capabilities={capabilities}
          actionContext={actionContext}
          onClose={() => setSelectedTask(null)}
          onStatusChange={(taskId, status) => updateTaskStatus({ taskId, status })}
          onComment={handleComment}
          onSaved={(updated) => { setSelectedTask(updated); invalidateAll() }}
          onDelete={capabilities.canDelete ? (task) => setDeleteTarget(task) : undefined}
          updating={updatingTask}
          startInEditMode={drawerEditMode}
        />
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={t('tasks.deleteConfirm.titleWithName', { title: deleteTarget?.title ?? t('tasks.deleteConfirm.fallbackTitle') })}
        onConfirm={() => deleteTarget && deleteTask(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksPageContent />
    </Suspense>
  )
}
