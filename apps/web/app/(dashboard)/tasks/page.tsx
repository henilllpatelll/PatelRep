'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ClipboardList, Clock, Search, SlidersHorizontal, LayoutGrid, Rows3 } from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type Priority, type CreateTaskData } from '@/lib/api/tasks'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { PageHeader } from '@/components/shared/PageHeader'
import { StateBlock } from '@/components/ui/StateBlock'
import { Button } from '@/components/ui/Button'
import { Pill, Mono } from '@/components/ui/primitives'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { GuestRequestDrawer } from '@/components/guest-requests/GuestRequestDrawer'
import { CreateTaskDrawer } from '@/components/tasks/CreateTaskDrawer'
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer'
import { UnifiedTaskRow } from '@/components/tasks/UnifiedTaskRow'
import { buildUnifiedTaskItems, sortUnifiedItems, type UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { getTaskCapabilities } from '@/lib/utils/taskCapabilities'
import { filterTaskItems, groupTaskItems, groupTaskItemsByLane, isTaskItemOnBoard } from '@/lib/utils/taskWorkspace'
import { TasksBoardView } from '@/components/tasks/TasksBoardView'
import { TasksTableView } from '@/components/tasks/TasksTableView'

// Guest Requests / Internal / Verify tabs were folded away: Verify is now a
// lane on the board, and Guest/Internal became the Type filter below (source
// type param, ?type=guest_request|internal) instead of separate tabs.
type ViewTab = 'active' | 'history'
const VIEW_TABS: ViewTab[] = ['active', 'history']
type BoardMode = 'board' | 'table'
const BOARD_MODE_KEY = 'patelrep-tasks-board-mode'
type SourceTypeFilter = UnifiedTaskItem['sourceType'] | ''

// "Active" is the board: new + in_progress + verify + anything completed earlier
// today. Older completions live in History — see isTaskItemOnBoard.
function bucketFor(view: ViewTab, item: UnifiedTaskItem): boolean {
  switch (view) {
    case 'active': return isTaskItemOnBoard(item)
    case 'history': return item.displayStatus === 'done'
  }
}

function TasksPageContent() {
  const { t } = useTranslation()
  const { role } = useRole()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [view, setView] = useState<ViewTab>(() => {
    const v = searchParams.get('view')
    return (VIEW_TABS as string[]).includes(v ?? '') ? (v as ViewTab) : 'active'
  })
  const [boardMode, setBoardMode] = useState<BoardMode>('board')
  useEffect(() => {
    const saved = window.localStorage.getItem(BOARD_MODE_KEY)
    if (saved === 'board' || saved === 'table') setBoardMode(saved)
  }, [])
  function changeBoardMode(mode: BoardMode) {
    setBoardMode(mode)
    try { window.localStorage.setItem(BOARD_MODE_KEY, mode) } catch { /* private-window storage can throw — the toggle still works for this session */ }
  }
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('')
  // Seeded from ?type= so external "view guest requests" links (housekeeping page,
  // CommandPalette, the legacy /guest-requests redirect) still land pre-filtered.
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>(() => {
    const v = searchParams.get('type')
    return v === 'guest_request' || v === 'internal' ? v : ''
  })
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showCreateDrawer, setShowCreateDrawer] = useState(false)
  const [quickAddText, setQuickAddText] = useState('')
  const [quickAddSeed, setQuickAddSeed] = useState('')
  function openCreateDrawer(seed?: string) {
    setQuickAddSeed(seed ?? '')
    setShowCreateDrawer(true)
  }

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerEditMode, setDrawerEditMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [selectedGuestRequest, setSelectedGuestRequest] = useState<GuestRequest | null>(null)

  const appliedFocusRef = useRef<string | null>(null)

  function handleTabChange(tab: ViewTab) {
    setView(tab)
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'active') params.delete('view')
    else params.set('view', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['guest-requests-kanban'] })
  }

  const { data: tasksResponse, isLoading: tasksLoading, isError: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', 'unified'],
    queryFn: () => tasksApi.list({ per_page: 100 }),
  })
  const tasks: Task[] = useMemo(() => (tasksResponse as any)?.data ?? [], [tasksResponse])

  const { data: guestResponse, isLoading: guestLoading, isError: guestError, refetch: refetchGuests } = useQuery({
    queryKey: ['guest-requests-kanban'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
  const guestRequests: GuestRequest[] = useMemo(() => (guestResponse as any)?.data ?? [], [guestResponse])

  const isLoading = tasksLoading || guestLoading
  const isError = tasksError || guestError

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

  const { mutate: deleteTask, isPending: deleting } = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => { invalidateAll(); setDeleteTarget(null); setSelectedTask(null) },
  })

  const handleComment = async (taskId: string, comment: string) => {
    await tasksApi.addComment(taskId, comment)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
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

  const filteredItems = useMemo(() => filterTaskItems(tabItems, { search, priority: priorityFilter, sourceType: sourceTypeFilter, assigneeId: assigneeFilter, department: departmentFilter, overdueOnly }), [tabItems, priorityFilter, sourceTypeFilter, assigneeFilter, departmentFilter, overdueOnly, search])
  const groupedItems = useMemo(() => groupTaskItems(filteredItems), [filteredItems])
  const lanes = useMemo(() => groupTaskItemsByLane(filteredItems), [filteredItems])

  const overdueCount = allItems.filter(i => i.slaBreached).length
  const urgentCount = allItems.filter(i => i.priority === 'urgent' && i.displayStatus !== 'done').length

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
                <Pill tone="alert" size="sm"><Clock size={9} /> <Mono>{overdueCount}</Mono> {t('tasks.overdueLabel')}</Pill>
              )}
              {urgentCount > 0 && (
                <Pill tone="caution" size="sm"><Mono>{urgentCount}</Mono> {t('tasks.urgentLabel')}</Pill>
              )}
            </>
          }
          actions={capabilities.canCreate ? (
            <Button variant="primary" onClick={() => openCreateDrawer()} className="gap-1.5 shrink-0">
              <Plus size={15} />{t('tasks.unified.newTaskButton')}
            </Button>
          ) : undefined}
          tabs={VIEW_TABS.map((tab) => ({
            label: t(`tasks.unified.tabs.${tab}`),
            count: tabCounts[tab],
            active: view === tab,
            onClick: () => handleTabChange(tab),
          }))}
        />
      </div>

      {view === 'active' && capabilities.canCreate && (
        <form
          onSubmit={(e) => { e.preventDefault(); const value = quickAddText.trim(); if (!value) return; setQuickAddText(''); openCreateDrawer(value) }}
          className="shrink-0 flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-4 py-2 text-ink3"
        >
          <Plus size={16} className="shrink-0" />
          <input
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            placeholder={t('tasks.board.quickAddPlaceholder')}
            aria-label={t('tasks.board.quickAddPlaceholder')}
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink4 focus:outline-none"
          />
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink4">{t('tasks.board.quickAddHint')}</kbd>
        </form>
      )}

      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" /><input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tasks.unified.searchPlaceholder')}
          aria-label={t('tasks.unified.searchPlaceholder')}
          className="w-full border border-[var(--line)] rounded-lg py-2.5 pl-9 pr-3 text-sm bg-surface text-ink2 placeholder:text-ink4 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        /></div>
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
      </div>

      {/* List — this region fills the rest of the viewport and owns its own scroll,
          so the page itself never grows past the viewport. On wide screens the board
          (TasksBoardView) fills this region exactly and each lane scrolls on its own;
          this wrapper's overflow-y-auto is the fallback for narrower layouts where a
          lane's natural height exceeds the region. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[42px] bg-surface-2 border border-line-2 rounded-[var(--r-md)] animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <StateBlock status="error" error={{ message: t('tasks.loadError'), onRetry: () => { refetchTasks(); refetchGuests() } }} />
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
          <TasksBoardView lanes={lanes} onOpen={openItem} />
        ) : view === 'active' && boardMode === 'table' ? (
          <TasksTableView
            lanes={lanes}
            onOpen={openItem}
            onEdit={capabilities.canEdit ? editInternalItem : undefined}
            onDelete={capabilities.canDelete ? deleteInternalItem : undefined}
            showActions={capabilities.canEdit || capabilities.canDelete}
          />
        ) : (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            {groupedItems.map((group) => <div key={group.key}><p className="border-b border-line bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-[.1em] text-ink3">{t(`tasks.workspace.groups.${group.key}`)}</p>{group.items.map((item) => <UnifiedTaskRow key={item.id} item={item} onOpen={openItem} onEdit={capabilities.canEdit && item.sourceType === 'internal' ? editInternalItem : undefined} onDelete={capabilities.canDelete && item.sourceType === 'internal' ? deleteInternalItem : undefined} showActions={capabilities.canEdit || capabilities.canDelete} />)}</div>)}
          </div>
        )}
      </div>

      <CreateTaskDrawer isOpen={showCreateDrawer} onClose={() => setShowCreateDrawer(false)} onCreateTask={createTask} onCreated={invalidateAll} staff={staffList} canAssign={capabilities.canAssign} creating={creatingTask} initialTitle={quickAddSeed} />

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
          onClose={() => setSelectedTask(null)}
          onStatusChange={(taskId, status) => updateTaskStatus({ taskId, status })}
          onComment={handleComment}
          onSaved={(updated) => { setSelectedTask(updated); invalidateAll() }}
          updating={updatingTask}
          startInEditMode={drawerEditMode}
          staff={staffList}
          canReassign={capabilities.canReassign}
          canUpdateStatus={capabilities.canUpdateTaskStatus}
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
