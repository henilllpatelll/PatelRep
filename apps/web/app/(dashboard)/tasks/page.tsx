'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Plus, ClipboardList, Clock, Bed, Users, HelpCircle,
  X, Send, Pencil,
} from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type TaskType, type Priority, type CreateTaskData } from '@/lib/api/tasks'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { Pill, AILabel, Mono } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button, IconButton } from '@/components/ui/Button'

function getTaskTypeOptions(t: TFunction): Array<{ value: TaskType; label: string }> {
  return [
    { value: 'housekeeping', label: t('tasks.types.housekeeping') },
    { value: 'guest_request', label: t('tasks.types.guestRequest') },
    { value: 'general', label: t('tasks.types.general') },
  ]
}

function getTaskTypeLabels(t: TFunction): Record<string, string> {
  return {
    housekeeping: t('tasks.types.housekeeping'),
    guest_request: t('tasks.types.guestRequest'),
    general: t('tasks.types.general'),
    engineering: t('tasks.typeLabels.engineering'),
    lost_found: t('tasks.typeLabels.lostFound'),
  }
}

function getPriorityOptions(t: TFunction): Array<{ value: Priority; label: string }> {
  return [
    { value: 'urgent', label: t('tasks.priorities.urgent') },
    { value: 'normal', label: t('tasks.priorities.normal') },
    { value: 'low', label: t('tasks.priorities.low') },
  ]
}

const SparkIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
  </svg>
)

function taskTypeIcon(taskType: string) {
  if (taskType === 'housekeeping') return <Bed size={13} className="shrink-0" />
  if (taskType === 'guest_request') return <Users size={13} className="shrink-0" />
  return <HelpCircle size={13} className="shrink-0" />
}

function priorityTone(p: Priority): 'alert' | 'caution' | 'neutral' {
  if (p === 'urgent') return 'alert'
  if (p === 'normal') return 'caution'
  return 'neutral'
}

function formatDuration(t: TFunction, totalMinutes: number): string {
  const abs = Math.abs(totalMinutes)
  const days = Math.floor(abs / 1440)
  const hours = Math.floor((abs % 1440) / 60)
  const mins = abs % 60
  if (days >= 1) return days === 1 ? t('tasks.durationDayOne', { count: days }) : t('tasks.durationDayOther', { count: days })
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function DueTime({ task, isOverdue }: { task: Task; isOverdue: boolean }) {
  const { t } = useTranslation()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!task.due_at || task.status === 'completed' || task.status === 'cancelled' || now === null) return null
  const due = new Date(task.due_at).getTime()
  const diffMin = Math.round((due - now) / 60000)
  const label = diffMin < 0
    ? t('tasks.dueTimeOverdue', { duration: formatDuration(t, diffMin) })
    : new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <Mono className={`text-[11px] min-w-[64px] text-right ${isOverdue ? 'text-[var(--alert)]' : 'text-ink3'}`}>
      {label}
    </Mono>
  )
}

function sortTasksFlat(tasks: Task[], now: number | null): Task[] {
  const priorityOrder: Record<Priority, number> = { urgent: 0, normal: 1, low: 2 }

  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'completed' || a.status === 'cancelled'
    const bDone = b.status === 'completed' || b.status === 'cancelled'
    if (aDone !== bDone) return aDone ? 1 : -1
    if (aDone && bDone) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

    const aOverdue = !!(now && a.due_at && new Date(a.due_at).getTime() < now)
    const bOverdue = !!(now && b.due_at && new Date(b.due_at).getTime() < now)
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1

    const priDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (priDiff !== 0) return priDiff

    if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
    if (a.due_at) return -1
    if (b.due_at) return 1

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function TaskRow({
  task,
  isOverdue,
  onOpen,
  onStatusChange,
  onEdit,
  onDelete,
  updating,
}: {
  task: Task
  isOverdue: boolean
  onOpen: (task: Task) => void
  onStatusChange: (id: string, s: TaskStatus) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  updating: boolean
}) {
  const { t } = useTranslation()
  const isDone = task.status === 'completed' || task.status === 'cancelled'

  return (
    <div
      role="button"
      tabIndex={0}
      className={`relative flex items-center gap-[11px] px-3 py-[10px] border-b border-[var(--line-2)] last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors ${isDone ? 'opacity-50' : ''}`}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task) } }}
    >
      {isOverdue && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--alert)] rounded-l" />
      )}
      <span
        role="checkbox"
        aria-checked={isDone}
        tabIndex={-1}
        className="w-[18px] h-[18px] rounded-[5px] border-[1.5px] border-[var(--line)] shrink-0 flex items-center justify-center hover:border-[var(--accent)] transition-colors"
        onClick={(e) => {
          e.stopPropagation()
          if (task.status === 'open') onStatusChange(task.id, 'in_progress')
          else if (task.status === 'in_progress') onStatusChange(task.id, 'completed')
        }}
      >
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="var(--ready)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>

      <Pill tone={priorityTone(task.priority)} size="sm">{task.priority}</Pill>

      <span className="text-ink3 shrink-0">{taskTypeIcon(task.task_type)}</span>

      <span className={`text-[13.5px] flex-1 min-w-0 text-ink truncate ${isDone ? 'line-through text-ink3' : ''}`}>
        {task.title}
      </span>

      {task.is_ai_created && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ai)] bg-[var(--ai-soft)] border border-[var(--ai-line)] px-[6px] py-px rounded-[4px] tracking-[0.4px] shrink-0">
          <SparkIcon /> {t('tasks.aiBadge')}
        </span>
      )}

      {task.rooms && (
        <span className="text-[10.5px] text-ink3 bg-surface-3 px-[5px] py-px rounded-[3px] shrink-0">
          #{task.rooms.room_number}
        </span>
      )}

      {task.user_profiles && (
        <span className="w-[22px] h-[22px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[9px] font-bold flex items-center justify-center shrink-0 uppercase">
          {(task.user_profiles.preferred_name ?? task.user_profiles.full_name ?? '?').slice(0, 2)}
        </span>
      )}

      <DueTime task={task} isOverdue={isOverdue} />

      <div onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          onEdit={!isDone ? () => onEdit(task) : undefined}
          onDelete={() => onDelete(task)}
        />
      </div>
    </div>
  )
}

function CreateTaskModal({ onClose, onCreate, creating }: {
  onClose: () => void
  onCreate: (data: CreateTaskData) => Promise<void>
  creating: boolean
}) {
  const { t } = useTranslation()
  const taskTypeOptions = getTaskTypeOptions(t)
  const priorityOptions = getPriorityOptions(t)
  const modalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')
    const first = focusable[0]; const last = focusable[focusable.length - 1]
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus() } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }
    document.addEventListener('keydown', onKey)
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { role } = useRole()
  const canAssign = role === 'gm' || role === 'housekeeping_supervisor' || role === 'front_desk'
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    enabled: canAssign,
    select: (res) => (res.data as { staff: StaffMember[] }).staff.filter(s => s.role === 'housekeeper' && s.status === 'active'),
  })
  const housekeepers = staffData ?? []

  const [form, setForm] = useState<CreateTaskData>({ title: '', task_type: 'general', priority: 'normal', description: '', location_text: '', assigned_to: undefined })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof CreateTaskData, v: string) => setForm((f) => ({ ...f, [k]: v || undefined }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setError(null)
    try {
      await onCreate({ ...form, description: form.description || undefined, location_text: form.location_text || undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tasks.createModal.createError'))
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div ref={modalRef} className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h2 id="create-task-title" className="text-base font-semibold text-ink">{t('tasks.createModal.title')}</h2>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.createModal.closeAria')} className="text-ink3 hover:text-ink2"><X size={18} /></IconButton>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.locationLabel')}</label>
            <input value={form.location_text} onChange={(e) => set('location_text', e.target.value)} placeholder={t('tasks.createModal.locationPlaceholder')} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.titleLabel')}</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={t('tasks.createModal.titlePlaceholder')} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.typeLabel')}</label>
              <select value={form.task_type} onChange={(e) => set('task_type', e.target.value as TaskType)} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                {taskTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.priorityLabel')}</label>
              <select value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                {priorityOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
          {canAssign && housekeepers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.assignLabel')}</label>
              <select value={form.assigned_to ?? ''} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value || undefined }))} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                <option value="">{t('tasks.createModal.unassigned')}</option>
                {housekeepers.map(h => <option key={h.user_id} value={h.user_id}>{h.full_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">{t('tasks.createModal.notesLabel')}</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none" />
          </div>
          {error && <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" loading={creating} disabled={!form.title.trim()} className="flex-1">
              {t('tasks.createModal.create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TaskDetailDrawer({ task, onClose, onStatusChange, onComment, onSaved, updating, startInEditMode }: {
  task: Task
  onClose: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  onComment: (taskId: string, comment: string) => Promise<void>
  onSaved: (updated: Task) => void
  updating: boolean
  startInEditMode?: boolean
}) {
  const { t } = useTranslation()
  const taskTypeOptions = getTaskTypeOptions(t)
  const priorityOptions = getPriorityOptions(t)
  const taskTypeLabels = getTaskTypeLabels(t)
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [commentSuccess, setCommentSuccess] = useState(false)
  const [isEditing, setIsEditing] = useState(startInEditMode ?? false)
  const [editForm, setEditForm] = useState({ title: task.title, description: task.description ?? '', priority: task.priority, task_type: task.task_type, location_text: task.location_text ?? '' })
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [completeNotes, setCompleteNotes] = useState('')

  const { mutate: saveEdit, isPending: saving } = useMutation({
    mutationFn: () => tasksApi.update(task.id, { title: editForm.title, description: editForm.description || undefined, priority: editForm.priority as Priority, task_type: editForm.task_type as TaskType, location_text: editForm.location_text || undefined }),
    onSuccess: (result: any) => { setIsEditing(false); queryClient.invalidateQueries({ queryKey: ['tasks'] }); onSaved(result?.data ?? { ...task, ...editForm }) },
  })

  const { mutate: completeTask, isPending: completing } = useMutation({
    mutationFn: () => tasksApi.update(task.id, { status: 'completed', notes: completeNotes.trim() || undefined }),
    onSuccess: (result: any) => { setShowCompleteForm(false); setCompleteNotes(''); queryClient.invalidateQueries({ queryKey: ['tasks'] }); onSaved(result?.data ?? { ...task, status: 'completed' }) },
  })

  const handleComment = async () => {
    if (!comment.trim()) return
    setSubmitting(true)
    try { await onComment(task.id, comment.trim()); setComment(''); setCommentSuccess(true); setTimeout(() => setCommentSuccess(false), 2000) }
    finally { setSubmitting(false) }
  }

  const isDone = task.status === 'completed' || task.status === 'cancelled'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/10 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-96 bg-surface/[0.88] backdrop-blur-2xl border-l border-[var(--line)] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-ink3">{taskTypeIcon(task.task_type)}</span>
            <h2 className="font-semibold text-ink text-sm">
              {taskTypeLabels[task.task_type] ?? task.task_type}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {!isDone && (
              <IconButton variant="ghost" size="sm" onClick={() => setIsEditing((v) => !v)} aria-label={t('tasks.detail.editAria')} className="text-ink3 hover:text-ink2"><Pencil size={15} /></IconButton>
            )}
            <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.detail.closeAria')} className="text-ink3 hover:text-ink2"><X size={18} /></IconButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isEditing && (
            <div className="bg-[var(--caution-soft)] border border-[var(--caution-line)] rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--caution)]">{t('tasks.detail.editHeading')}</p>
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

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Pill tone={priorityTone(task.priority)} size="sm">{task.priority}</Pill>
              {task.is_ai_created && <AILabel>{t('tasks.detail.aiCreated')}</AILabel>}
            </div>
            <h3 className="text-base font-semibold text-ink">{task.title}</h3>
            {task.description && <p className="text-sm text-ink2 mt-1">{task.description}</p>}
          </div>

          <div className="bg-surface-2 border border-[var(--line)] rounded-xl p-4 space-y-2.5 text-sm">
            {task.rooms && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">{t('tasks.detail.room')}</span>
                <Mono className="font-medium text-ink">{task.rooms.room_number}</Mono>
              </div>
            )}
            {task.location_text && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">{t('tasks.detail.location')}</span>
                <span className="font-medium text-ink">{task.location_text}</span>
              </div>
            )}
            {task.user_profiles && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">{t('tasks.detail.assignedTo')}</span>
                <span className="font-medium text-ink">{task.user_profiles.preferred_name}</span>
              </div>
            )}
            {task.due_at && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">{t('tasks.detail.due')}</span>
                <Mono className="font-medium text-ink">{new Date(task.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-ink3">{t('tasks.detail.created')}</span>
              <Mono className="font-medium text-ink">{new Date(task.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
            </div>
            {task.completed_at && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">{t('tasks.detail.completed')}</span>
                <Mono className="font-medium text-[var(--ready)]">{new Date(task.completed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
              </div>
            )}
          </div>

          {!isDone && (
            <div>
              <p className="text-xs font-medium text-ink3 mb-2">{t('tasks.detail.updateStatus')}</p>
              <div className="flex gap-2">
                {task.status === 'open' && (
                  <Button variant="primary" disabled={updating} onClick={() => onStatusChange(task.id, 'in_progress')} className="flex-1 bg-[var(--caution)]">{t('tasks.detail.start')}</Button>
                )}
                {task.status === 'in_progress' && !showCompleteForm && (
                  <Button variant="primary" disabled={updating} onClick={() => setShowCompleteForm(true)} className="flex-1 bg-[var(--ready)]">{t('tasks.detail.markComplete')}</Button>
                )}
                <Button variant="outline" disabled={updating} onClick={() => onStatusChange(task.id, 'cancelled')}>{t('common.cancel')}</Button>
              </div>
              {showCompleteForm && (
                <div className="mt-3 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-[var(--ready)]">{t('tasks.detail.completionNotesLabel')}</p>
                  <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} rows={2} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--ready)]/40 resize-none" />
                  <div className="flex gap-2">
                    <Button variant="primary" loading={completing} onClick={() => completeTask()} className="flex-1 bg-[var(--ready)]">
                      {t('tasks.detail.confirm')}
                    </Button>
                    <Button variant="outline" onClick={() => { setShowCompleteForm(false); setCompleteNotes('') }}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-ink3 mb-2">
              {t('tasks.detail.comments')} {task.task_comments && task.task_comments.length > 0 && `(${task.task_comments.length})`}
            </p>
            {(!task.task_comments || task.task_comments.length === 0) && (
              <p className="text-xs text-ink3 italic">{t('tasks.detail.noComments')}</p>
            )}
            <div className="space-y-2">
              {task.task_comments?.map((c) => (
                <div key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.is_system ? 'bg-surface-2 text-ink3 italic' : 'bg-[var(--info-soft)] text-ink'}`}>
                  <p>{c.comment}</p>
                  <p className="text-xs text-ink3 mt-0.5">{new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--line)] shrink-0">
          {commentSuccess && <p className="text-xs text-[var(--ready)] mb-1.5">{t('tasks.detail.commentAdded')}</p>}
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!submitting) handleComment() } }}
              placeholder={t('tasks.detail.commentPlaceholder')}
              aria-label={t('tasks.detail.commentAria')}
              className="flex-1 text-sm px-3 py-2 bg-surface-2 border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            />
            <IconButton
              variant="primary"
              loading={submitting}
              disabled={!comment.trim()}
              onClick={handleComment}
              aria-label={t('tasks.detail.commentAria')}
            >
              <Send size={14} />
            </IconButton>
          </div>
        </div>
      </div>
    </>
  )
}

function TasksPageContent() {
  const { t } = useTranslation()
  const taskTypeOptions = getTaskTypeOptions(t)
  const priorityOptions = getPriorityOptions(t)
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>((searchParams.get('tab') as 'all' | TaskStatus) || 'all')
  const [typeFilter, setTypeFilter] = useState<TaskType | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerEditMode, setDrawerEditMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [now, setNow] = useState<number | null>(null)

  function handleTabChange(tab: 'all' | TaskStatus) {
    setStatusFilter(tab)
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'all') params.delete('tab')
    else params.set('tab', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const { mutate: deleteTask, isPending: deleting } = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); setDeleteTarget(null); setSelectedTask(null) },
  })

  const filters = {
    ...(statusFilter !== 'all' && { status: statusFilter as TaskStatus }),
    ...(typeFilter && { task_type: typeFilter as TaskType }),
    ...(priorityFilter && { priority: priorityFilter as Priority }),
    per_page: 100,
  }

  const { data: response, isLoading } = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => tasksApi.list(filters),
  })
  const tasks: Task[] = (response as any)?.data ?? []

  const { mutateAsync: createTask, isPending: creating } = useMutation({
    mutationFn: (data: CreateTaskData) => tasksApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); setShowCreate(false) },
  })

  const { mutate: updateStatus, isPending: updating } = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => tasksApi.update(taskId, { status }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setSelectedTask((prev) => prev && prev.id === variables.taskId ? { ...prev, status: variables.status } : prev)
    },
  })

  const handleStatusChange = (taskId: string, status: TaskStatus) => updateStatus({ taskId, status })

  const handleComment = async (taskId: string, comment: string) => {
    await tasksApi.addComment(taskId, comment)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    const res = await tasksApi.get(taskId) as any
    if (res?.data) setSelectedTask(res.data)
  }

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const activeTasks = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
  const urgentCount = activeTasks.filter((task) => task.priority === 'urgent').length
  const overdueCount = now
    ? activeTasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < now).length
    : 0
  const inProgressCount = activeTasks.filter((task) => task.status === 'in_progress').length

  const sortedTasks = sortTasksFlat(tasks, now)

  const STATUS_TABS = [
    { value: 'all' as const, label: t('tasks.tabs.all') },
    { value: 'open' as const, label: t('tasks.tabs.open') },
    { value: 'in_progress' as const, label: t('tasks.tabs.inProgress') },
    { value: 'completed' as const, label: t('tasks.tabs.completed') },
    { value: 'cancelled' as const, label: t('tasks.tabs.cancelled') },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('tasks.eyebrow')}
        title={t('tasks.title')}
        meta={
          <>
            {overdueCount > 0 && (
              <Pill tone="alert" size="sm"><Clock size={9} /> <Mono>{overdueCount}</Mono> {t('tasks.overdueLabel')}</Pill>
            )}
            {urgentCount > 0 && (
              <Pill tone="caution" size="sm"><Mono>{urgentCount}</Mono> {t('tasks.urgentLabel')}</Pill>
            )}
            {inProgressCount > 0 && (
              <Pill tone="info" size="sm"><Mono>{inProgressCount}</Mono> {t('tasks.inProgressLabel')}</Pill>
            )}
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)} className="gap-1.5 shrink-0">
            <Plus size={15} />{t('tasks.newTaskButton')}
          </Button>
        }
      />

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-nowrap gap-1 border-b border-[var(--line)] overflow-x-auto flex-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              className={`flex-shrink-0 whitespace-nowrap px-3.5 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                statusFilter === tab.value
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-ink3 hover:text-ink2'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 shrink-0 pb-px">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TaskType | '')}
            aria-label={t('tasks.filterTypeAria')}
            className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none"
          >
            <option value="">{t('tasks.allTypesOption')}</option>
            {taskTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as Priority | '')}
            aria-label={t('tasks.filterPriorityAria')}
            className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none"
          >
            <option value="">{t('tasks.allPrioritiesOption')}</option>
            {priorityOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[42px] bg-surface-2 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="bg-surface border border-[var(--line)] rounded-[var(--r-lg)] p-12 text-center">
          <ClipboardList size={36} className="mx-auto text-ink4 mb-3" />
          <p className="text-ink2 font-medium">{t('tasks.empty.title')}</p>
          <p className="text-sm text-ink3 mt-1">{t('tasks.empty.subtitle')}</p>
          <Button variant="primary" onClick={() => setShowCreate(true)} className="mt-4 gap-1.5 mx-auto">
            <Plus size={14} />{t('tasks.empty.button')}
          </Button>
        </div>
      ) : (
        <div className="bg-surface border border-[var(--line)] rounded-[var(--r-lg)] overflow-hidden">
          {sortedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isOverdue={!!(now && task.due_at && new Date(task.due_at).getTime() < now && task.status !== 'completed' && task.status !== 'cancelled')}
              onOpen={(task) => { setDrawerEditMode(false); setSelectedTask(task) }}
              onStatusChange={handleStatusChange}
              onEdit={(task) => { setDrawerEditMode(true); setSelectedTask(task) }}
              onDelete={setDeleteTarget}
              updating={updating}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={async (data) => { await createTask(data) }}
          creating={creating}
        />
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onStatusChange={handleStatusChange}
          onComment={handleComment}
          onSaved={(updated) => { setSelectedTask(updated); queryClient.invalidateQueries({ queryKey: ['tasks'] }) }}
          updating={updating}
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
