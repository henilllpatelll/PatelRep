'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, MoreVertical } from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type TaskType, type Priority } from '@/lib/api/tasks'
import { Pill, AILabel, Avatar } from '@/components/ui/primitives'
import { Button, IconButton } from '@/components/ui/Button'
import { getTaskTypeOptions, getTaskTypeLabels, getPriorityOptions, priorityTone, taskTypeIcon, statusTone, DueTime } from './taskDisplay'
import { TaskTimeline } from './TaskTimeline'
import { TaskCommentsPanel } from './TaskCommentsPanel'
import { TaskFilesPanel } from './TaskFilesPanel'
import { TaskNextAction, type TaskNextActionContext } from './TaskNextAction'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import type { TaskCapabilities } from '@/lib/utils/taskCapabilities'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

type DrawerTab = 'details' | 'comments' | 'files' | 'timeline'
const DRAWER_TABS: DrawerTab[] = ['details', 'comments', 'files', 'timeline']

function MoreMenu({ task, capabilities, isDone, onEdit, onCancelRequest, onDeleteRequest }: {
  task: Task
  capabilities: TaskCapabilities
  isDone: boolean
  onEdit: () => void
  onCancelRequest: () => void
  onDeleteRequest: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const showCancel = !isDone && capabilities.canUpdateTaskStatus
  const showDelete = !!onDeleteRequest && capabilities.canDelete
  if (isDone && !showDelete) return null

  return (
    <div className="relative">
      <IconButton ref={triggerRef} variant="ghost" size="sm" aria-label={t('tasks.detail.moreActionsAria')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-ink3 hover:text-ink2">
        <MoreVertical size={16} />
      </IconButton>
      {open && (
        <div ref={menuRef} role="menu" className="absolute right-0 z-30 mt-1.5 w-44 rounded-[var(--r-md)] border border-line bg-surface p-1.5 shadow-pop">
          {!isDone && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">
              {t('tasks.detail.editTask')}
            </button>
          )}
          {showCancel && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onCancelRequest() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">
              {t('tasks.detail.cancelTask')}
            </button>
          )}
          {showDelete && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onDeleteRequest!() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-[var(--alert)] hover:bg-[var(--alert-soft)]">
              {t('tasks.detail.deleteTask')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskDetailDrawer({ task, item, capabilities, actionContext, onClose, onStatusChange, onComment, onSaved, onDelete, updating, startInEditMode }: {
  task: Task
  /** The corresponding unified board item, when one exists — drives the shared
   * primary action/assignment control from Phase 3 (TaskNextAction). */
  item: UnifiedTaskItem | null
  capabilities: TaskCapabilities
  actionContext: TaskNextActionContext
  onClose: () => void
  /** Used only for the Cancel action — Start/Complete route through TaskNextAction. */
  onStatusChange: (taskId: string, status: TaskStatus) => void
  onComment: (taskId: string, comment: string) => Promise<void>
  onSaved: (updated: Task) => void
  onDelete?: (task: Task) => void
  updating: boolean
  startInEditMode?: boolean
}) {
  const { t } = useTranslation()
  const taskTypeOptions = getTaskTypeOptions(t)
  const priorityOptions = getPriorityOptions(t)
  const taskTypeLabels = getTaskTypeLabels(t)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<DrawerTab>('details')
  const [isEditing, setIsEditing] = useState(startInEditMode ?? false)
  const [editForm, setEditForm] = useState({ title: task.title, description: task.description ?? '', priority: task.priority, task_type: task.task_type, location_text: task.location_text ?? '' })
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const drawerRef = useRef<HTMLDivElement>(null!)
  useModalFocusTrap(drawerRef, true, onClose)

  const { mutate: saveEdit, isPending: saving } = useMutation({
    mutationFn: () => tasksApi.update(task.id, { title: editForm.title, description: editForm.description || undefined, priority: editForm.priority as Priority, task_type: editForm.task_type as TaskType, location_text: editForm.location_text || undefined }),
    onSuccess: (result: any) => { setIsEditing(false); queryClient.invalidateQueries({ queryKey: ['tasks'] }); onSaved(result?.data ?? { ...task, ...editForm }) },
  })

  const isDone = task.status === 'completed' || task.status === 'cancelled'
  const assigneeName = task.user_profiles?.preferred_name ?? task.user_profiles?.full_name ?? null
  const roomOrLocation = task.rooms ? `${t('tasks.detail.room')} ${task.rooms.room_number}` : task.location_text

  return (
    <>
      <div className="fixed inset-0 z-drawer bg-stone-900/10 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="fixed right-0 top-0 bottom-0 z-drawer w-full md:w-[480px] bg-surface/[0.88] backdrop-blur-2xl border-l border-[var(--line)] shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--line)] px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-ink">{task.title}</h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <MoreMenu
                task={task}
                capabilities={capabilities}
                isDone={isDone}
                onEdit={() => { setTab('details'); setIsEditing(true) }}
                onCancelRequest={() => setShowCancelConfirm(true)}
                onDeleteRequest={onDelete ? () => onDelete(task) : undefined}
              />
              <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.detail.closeAria')} className="text-ink3 hover:text-ink2"><X size={18} /></IconButton>
            </div>
          </div>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-ink3">
            <span className="shrink-0">{taskTypeIcon(task.task_type)}</span>
            {roomOrLocation ?? t('tasks.createModal.unassigned')} &middot; {t('tasks.board.sourceInternal')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(task.status)} size="sm">{t(`tasks.detail.statusLabels.${task.status}`)}</Pill>
            <Pill tone={priorityTone(task.priority)} size="sm">{t(`tasks.priorities.${task.priority}`)}</Pill>
            {task.is_ai_created && <AILabel>{t('tasks.detail.aiCreated')}</AILabel>}
            {!isDone && <DueTime dueAt={task.due_at} isDone={isDone} isOverdue={item?.slaBreached ?? false} />}
          </div>
        </div>

        {isDone && (
          <div className="shrink-0 border-b border-[var(--line)] bg-surface-2 px-5 py-2.5 text-xs text-ink3">
            {task.status === 'completed'
              ? t('tasks.detail.completedBanner', { time: task.completed_at ? new Date(task.completed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '', name: assigneeName ?? t('tasks.createModal.unassigned') })
              : t('tasks.detail.cancelledBanner', { time: task.cancelled_at ? new Date(task.cancelled_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' })}
          </div>
        )}

        {!isDone && item && (
          <div className="shrink-0 border-b border-[var(--line)] px-5 py-3">
            <TaskNextAction item={item} context={actionContext} />
          </div>
        )}

        {/* Tab nav */}
        <div role="tablist" aria-label={t('tasks.detail.tabsAria')} className="shrink-0 flex gap-1 border-b border-[var(--line)] px-3 pt-1">
          {DRAWER_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${tab === key ? 'text-ink border-b-2 border-[var(--accent)]' : 'text-ink3 hover:text-ink2'}`}
            >
              {t(`tasks.detail.tabs.${key}`)}
              {key === 'comments' && task.task_comments && task.task_comments.length > 0 ? ` (${task.task_comments.length})` : ''}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'details' && (
            <div className="h-full overflow-y-auto p-5 space-y-5">
              {isEditing && (
                <div className="bg-surface-2 border border-[var(--line)] rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-ink2">{t('tasks.detail.editHeading')}</p>
                  <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" placeholder={t('tasks.detail.titlePlaceholder')} />
                  <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none" placeholder={t('tasks.detail.notesPlaceholder')} />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as Priority }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none">
                      {priorityOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <select value={editForm.task_type} onChange={(e) => setEditForm((f) => ({ ...f, task_type: e.target.value as TaskType }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none">
                      {taskTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                  <input value={editForm.location_text} onChange={(e) => setEditForm((f) => ({ ...f, location_text: e.target.value }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none w-full" placeholder={t('tasks.detail.locationPlaceholder')} />
                  <div className="flex gap-2">
                    <Button variant="primary" loading={saving} disabled={!editForm.title.trim()} onClick={() => saveEdit()} className="flex-1">
                      {t('tasks.detail.save')}
                    </Button>
                    <Button variant="outline" onClick={() => setIsEditing(false)}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}

              {task.description && (
                <div>
                  <p className="mb-1 text-xs font-medium text-ink3">{t('tasks.detail.description')}</p>
                  <p className="text-sm text-ink2">{task.description}</p>
                </div>
              )}

              <div className="bg-surface-2 border border-[var(--line)] rounded-xl p-4 space-y-2.5 text-sm">
                {task.rooms && (
                  <div className="flex items-center justify-between">
                    <span className="text-ink3">{t('tasks.detail.room')}</span>
                    <span className="font-medium text-ink">{task.rooms.room_number}</span>
                  </div>
                )}
                {task.location_text && !task.rooms && (
                  <div className="flex items-center justify-between">
                    <span className="text-ink3">{t('tasks.detail.location')}</span>
                    <span className="font-medium text-ink">{task.location_text}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink3">{t('tasks.detail.assignedTo')}</span>
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    {assigneeName && <Avatar name={assigneeName} size={18} />}
                    {assigneeName ?? (task.task_type === 'housekeeping' ? t('tasks.createModal.unassignedHousekeeping') : t('tasks.createModal.unassigned'))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink3">{t('tasks.createModal.typeLabel')}</span>
                  <span className="font-medium text-ink">{taskTypeLabels[task.task_type] ?? task.task_type}</span>
                </div>
                {task.due_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-ink3">{t('tasks.detail.due')}</span>
                    <span className="font-medium text-ink">{new Date(task.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
              </div>

              {showCancelConfirm && (
                <div className="bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-[var(--alert)]">{t('tasks.detail.cancelConfirmTitle', { title: task.title })}</p>
                  <p className="text-xs text-ink3">{t('tasks.detail.cancelConfirmDescription')}</p>
                  <div className="flex gap-2">
                    <Button variant="destructive" loading={updating} onClick={() => { onStatusChange(task.id, 'cancelled'); setShowCancelConfirm(false) }} className="flex-1">
                      {t('tasks.detail.cancelTask')}
                    </Button>
                    <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'comments' && <TaskCommentsPanel task={task} onComment={onComment} />}
          {tab === 'files' && <div className="h-full overflow-y-auto"><TaskFilesPanel taskId={task.id} /></div>}
          {tab === 'timeline' && <div className="h-full overflow-y-auto p-5"><TaskTimeline task={task} /></div>}
        </div>
      </div>
    </>
  )
}
