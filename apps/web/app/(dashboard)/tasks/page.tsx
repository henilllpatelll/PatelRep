'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, ClipboardList, Clock } from 'lucide-react'
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
import { NewRequestModal } from '@/components/guest-requests/NewRequestModal'
import { NewTaskChooser } from '@/components/tasks/NewTaskChooser'
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal'
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer'
import { UnifiedTaskRow } from '@/components/tasks/UnifiedTaskRow'
import { buildUnifiedTaskItems, sortUnifiedItems, type UnifiedTaskItem } from '@/lib/utils/unifiedTasks'

type ViewTab = 'active' | 'guest' | 'internal' | 'verify' | 'history'
const VIEW_TABS: ViewTab[] = ['active', 'guest', 'internal', 'verify', 'history']

function bucketFor(view: ViewTab, item: UnifiedTaskItem): boolean {
  switch (view) {
    case 'active': return item.displayStatus === 'new' || item.displayStatus === 'in_progress'
    case 'guest': return item.sourceType === 'guest_request' && item.displayStatus !== 'done'
    case 'internal': return item.sourceType === 'internal' && item.displayStatus !== 'done'
    case 'verify': return item.displayStatus === 'verify'
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
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [showChooser, setShowChooser] = useState(false)
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [showInternalModal, setShowInternalModal] = useState(false)

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

  const canAssign = role === 'gm' || role === 'housekeeping_supervisor' || role === 'front_desk'
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    enabled: canAssign,
    select: (res) => (res.data as { staff: StaffMember[] }).staff.filter(s => s.status === 'active'),
  })
  const staffList = staffData ?? []

  const allItems = useMemo(
    () => sortUnifiedItems(buildUnifiedTaskItems(tasks, guestRequests)),
    [tasks, guestRequests],
  )

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

  // Deep link: ?view=guest&focus=<guestRequestId> — this is also what the legacy
  // /guest-requests?focus=<id> redirect forwards into.
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
    onSuccess: () => { invalidateAll(); setShowInternalModal(false) },
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

  const filteredItems = useMemo(() => tabItems.filter((item) => {
    if (priorityFilter && item.priority !== priorityFilter) return false
    if (assigneeFilter && item.assigneeId !== assigneeFilter) return false
    if (overdueOnly && !item.slaBreached) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const haystack = `${item.title} ${item.roomNumber ?? ''} ${item.locationText ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  }), [tabItems, priorityFilter, assigneeFilter, overdueOnly, search])

  const overdueCount = allItems.filter(i => i.slaBreached).length
  const urgentCount = allItems.filter(i => i.priority === 'urgent' && i.displayStatus !== 'done').length

  const tabCounts: Record<ViewTab, number> = {
    active: allItems.filter(i => bucketFor('active', i)).length,
    guest: allItems.filter(i => bucketFor('guest', i)).length,
    internal: allItems.filter(i => bucketFor('internal', i)).length,
    verify: allItems.filter(i => bucketFor('verify', i)).length,
    history: allItems.filter(i => bucketFor('history', i)).length,
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('tasks.unified.eyebrow')}
        title={t('tasks.unified.title')}
        subtitle={t('tasks.unified.subtitle')}
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
        actions={
          <Button variant="primary" onClick={() => setShowChooser(true)} className="gap-1.5 shrink-0">
            <Plus size={15} />{t('tasks.unified.newTaskButton')}
          </Button>
        }
        tabs={VIEW_TABS.map((tab) => ({
          label: t(`tasks.unified.tabs.${tab}`),
          count: tabCounts[tab],
          active: view === tab,
          onClick: () => handleTabChange(tab),
        }))}
      />

      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tasks.unified.searchPlaceholder')}
          aria-label={t('tasks.unified.searchPlaceholder')}
          className="min-w-[180px] flex-1 border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 placeholder:text-ink4 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        />
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | '')}
          aria-label={t('tasks.filterPriorityAria')}
          className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none"
        >
          <option value="">{t('tasks.allPrioritiesOption')}</option>
          <option value="urgent">{t('tasks.priorities.urgent')}</option>
          <option value="normal">{t('tasks.priorities.normal')}</option>
          <option value="low">{t('tasks.priorities.low')}</option>
        </select>
        {staffList.length > 0 && (
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label={t('tasks.unified.filterAssigneeAria')}
            className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none"
          >
            <option value="">{t('tasks.unified.allAssigneesOption')}</option>
            {staffList.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
            overdueOnly
              ? 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-[var(--alert)]'
              : 'border-[var(--line)] text-ink3 hover:bg-surface-2'
          }`}
        >
          {t('tasks.unified.overdueFilter')}
        </button>
      </div>

      {/* List */}
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
              action: (
                <Button variant="primary" onClick={() => setShowChooser(true)} className="gap-1.5">
                  <Plus size={14} />{t('tasks.empty.button')}
                </Button>
              ),
            }}
          />
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          {filteredItems.map((item) => (
            <UnifiedTaskRow
              key={item.id}
              item={item}
              onOpen={openItem}
              onEdit={item.sourceType === 'internal' ? editInternalItem : undefined}
              onDelete={item.sourceType === 'internal' ? deleteInternalItem : undefined}
            />
          ))}
        </div>
      )}

      {showChooser && (
        <NewTaskChooser
          onClose={() => setShowChooser(false)}
          onPickGuest={() => { setShowChooser(false); setShowGuestModal(true) }}
          onPickInternal={() => { setShowChooser(false); setShowInternalModal(true) }}
        />
      )}

      <NewRequestModal
        isOpen={showGuestModal}
        onClose={() => setShowGuestModal(false)}
        onSuccess={invalidateAll}
      />

      {showInternalModal && (
        <CreateTaskModal
          onClose={() => setShowInternalModal(false)}
          onCreate={async (data) => { await createTask(data) }}
          creating={creatingTask}
        />
      )}

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
