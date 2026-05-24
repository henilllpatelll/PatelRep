'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ClipboardList, Clock, Bed, Wrench, Users, HelpCircle,
  X, Send, Loader2, Pencil, Mic,
} from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type TaskType, type Priority, type CreateTaskData } from '@/lib/api/tasks'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { Pill, StatusDot, AILabel, Mono, SectionLabel, Bar } from '@/components/ui/primitives'

const TASK_TYPES: Array<{ value: TaskType; label: string }> = [
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'engineering', label: 'Maintenance' },
  { value: 'guest_request', label: 'Guest Request' },
  { value: 'lost_found', label: 'Lost & Found' },
  { value: 'general', label: 'General' },
]

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  housekeeping: 'Housekeeping',
  engineering: 'Maintenance',
  guest_request: 'Guest Request',
  lost_found: 'Lost & Found',
  general: 'General',
}

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const SparkIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
  </svg>
)

function taskTypeIcon(t: TaskType) {
  if (t === 'housekeeping') return <Bed size={13} className="shrink-0" />
  if (t === 'engineering') return <Wrench size={13} className="shrink-0" />
  if (t === 'guest_request') return <Users size={13} className="shrink-0" />
  return <HelpCircle size={13} className="shrink-0" />
}

function priorityTone(p: Priority): 'alert' | 'caution' | 'neutral' {
  if (p === 'urgent') return 'alert'
  if (p === 'normal') return 'caution'
  return 'neutral'
}

function formatDuration(totalMinutes: number): string {
  const abs = Math.abs(totalMinutes)
  const days = Math.floor(abs / 1440)
  const hours = Math.floor((abs % 1440) / 60)
  const mins = abs % 60
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function DueTime({ task, isOverdue }: { task: Task; isOverdue: boolean }) {
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
    ? `${formatDuration(diffMin)} overdue`
    : new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <Mono className={`text-[11px] min-w-[72px] text-right ${isOverdue ? 'text-[var(--alert)]' : 'text-ink-3'}`}>
      {label}
    </Mono>
  )
}

function groupTasks(tasks: Task[]): Array<{ label: string; tone: string; items: Task[] }> {
  const now = Date.now()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 6)

  const overdue: Task[] = []
  const today: Task[] = []
  const thisWeek: Task[] = []
  const other: Task[] = []

  for (const t of tasks) {
    if (t.status === 'completed' || t.status === 'cancelled') continue
    if (!t.due_at) { other.push(t); continue }
    const due = new Date(t.due_at).getTime()
    if (due < now) overdue.push(t)
    else if (due <= todayEnd.getTime()) today.push(t)
    else if (due <= weekEnd.getTime()) thisWeek.push(t)
    else other.push(t)
  }

  const groups = []
  if (overdue.length) groups.push({ label: 'Overdue', tone: 'alert', items: overdue })
  if (today.length) groups.push({ label: 'Today', tone: 'caution', items: today })
  if (thisWeek.length) groups.push({ label: 'This week', tone: 'info', items: thisWeek })
  if (other.length) groups.push({ label: 'No due date', tone: 'neutral', items: other })
  return groups
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
  onOpen: (t: Task) => void
  onStatusChange: (id: string, s: TaskStatus) => void
  onEdit: (t: Task) => void
  onDelete: (t: Task) => void
  updating: boolean
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex items-center gap-[11px] px-2 py-[10px] border-b border-[var(--line-2)] hover:bg-surface-2 cursor-pointer transition-colors"
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task) } }}
    >
      <span
        className="w-[18px] h-[18px] rounded-[5px] border-[1.5px] border-[var(--line)] shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          if (task.status === 'open') onStatusChange(task.id, 'in_progress')
          else if (task.status === 'in_progress') onStatusChange(task.id, 'completed')
        }}
      />
      <Pill tone={priorityTone(task.priority)} size="sm">{task.priority}</Pill>
      <span className="flex items-center gap-1.5 text-ink2 shrink-0">
        {taskTypeIcon(task.task_type)}
      </span>
      <span className="text-[13.5px] flex-1 min-w-0 text-ink truncate">{task.title}</span>
      {task.is_ai_created && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ai)] bg-[var(--ai-soft)] border border-[var(--ai-line)] px-[6px] py-px rounded-[4px] tracking-[0.4px] shrink-0">
          <SparkIcon /> AI
        </span>
      )}
      <div className="flex gap-[5px] shrink-0">
        {task.rooms && (
          <span className="text-[10.5px] text-ink-3 bg-surface-3 px-[5px] py-px rounded-[3px]">
            #{task.rooms.room_number}
          </span>
        )}
        <span className="text-[10.5px] text-ink-3 bg-surface-3 px-[5px] py-px rounded-[3px]">
          #{TASK_TYPE_LABELS[task.task_type].toLowerCase().replace(' ', '-')}
        </span>
      </div>
      {task.user_profiles && (
        <span className="w-[22px] h-[22px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[9px] font-bold flex items-center justify-center shrink-0 uppercase">
          {(task.user_profiles.preferred_name ?? task.user_profiles.full_name ?? '?').slice(0, 2)}
        </span>
      )}
      <DueTime task={task} isOverdue={isOverdue} />
      <div onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          onEdit={task.status === 'open' || task.status === 'in_progress' ? () => onEdit(task) : undefined}
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
      setError(err instanceof Error ? err.message : 'Failed to create task.')
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div ref={modalRef} className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h2 id="create-task-title" className="text-base font-semibold text-ink">New Task</h2>
          <button onClick={onClose} className="text-ink3 hover:text-ink2 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Location (optional)</label>
            <input value={form.location_text} onChange={(e) => set('location_text', e.target.value)} placeholder="e.g. Room 302, Lobby" className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Title *</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Fix leaking faucet in Room 302" className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Type</label>
              <select value={form.task_type} onChange={(e) => set('task_type', e.target.value as TaskType)} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Priority</label>
              <select value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          {canAssign && housekeepers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Assign to (optional)</label>
              <select value={form.assigned_to ?? ''} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value || undefined }))} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40">
                <option value="">Unassigned</option>
                {housekeepers.map(h => <option key={h.user_id} value={h.user_id}>{h.full_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Description (optional)</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none" />
          </div>
          {error && <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-medium text-ink2 border border-[var(--line)] rounded-lg hover:bg-surface-3 transition-colors">Cancel</button>
            <button type="submit" disabled={creating || !form.title.trim()} className="flex-1 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-opacity">
              {creating && <Loader2 size={13} className="animate-spin" />}Create Task
            </button>
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/10 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-96 bg-surface/[0.88] backdrop-blur-2xl border-l border-[var(--line)] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-ink3">{taskTypeIcon(task.task_type)}</span>
            <h2 className="font-semibold text-ink text-sm">Task Details</h2>
          </div>
          <div className="flex items-center gap-1">
            {task.status !== 'completed' && task.status !== 'cancelled' && (
              <button onClick={() => setIsEditing((v) => !v)} className="text-ink3 hover:text-ink2 p-1"><Pencil size={15} /></button>
            )}
            <button onClick={onClose} className="text-ink3 hover:text-ink2 p-1"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isEditing && (
            <div className="bg-[var(--caution-soft)] border border-[var(--caution-line)] rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--caution)]">Edit Task</p>
              <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" placeholder="Title" />
              <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-none" placeholder="Description" />
              <div className="grid grid-cols-2 gap-2">
                <select value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as Priority }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none">
                  <option value="urgent">Urgent</option><option value="normal">Normal</option><option value="low">Low</option>
                </select>
                <select value={editForm.task_type} onChange={(e) => setEditForm((f) => ({ ...f, task_type: e.target.value as TaskType }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none">
                  {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <input value={editForm.location_text} onChange={(e) => setEditForm((f) => ({ ...f, location_text: e.target.value }))} className="text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none w-full" placeholder="Location" />
              <div className="flex gap-2">
                <button onClick={() => saveEdit()} disabled={saving || !editForm.title.trim()} className="flex-1 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1">
                  {saving && <Loader2 size={12} className="animate-spin" />}Save
                </button>
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-ink2 border border-[var(--line)] rounded-lg hover:bg-surface-3">Cancel</button>
              </div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Pill tone={priorityTone(task.priority)} size="sm">{task.priority}</Pill>
              {task.is_ai_created && <AILabel>AI created</AILabel>}
            </div>
            <h3 className="text-base font-semibold text-ink">{task.title}</h3>
            {task.description && <p className="text-sm text-ink2 mt-1">{task.description}</p>}
          </div>

          <div className="bg-surface-2 border border-[var(--line)] rounded-xl p-4 space-y-2.5 text-sm">
            {task.rooms && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Room</span>
                <Mono className="font-medium text-ink">{task.rooms.room_number}</Mono>
              </div>
            )}
            {task.location_text && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Location</span>
                <span className="font-medium text-ink">{task.location_text}</span>
              </div>
            )}
            {task.user_profiles && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Assigned to</span>
                <span className="font-medium text-ink">{task.user_profiles.preferred_name}</span>
              </div>
            )}
            {task.due_at && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Due</span>
                <Mono className="font-medium text-ink">{new Date(task.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-ink3">Created</span>
              <Mono className="font-medium text-ink">{new Date(task.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
            </div>
            {task.completed_at && (
              <div className="flex items-center justify-between">
                <span className="text-ink3">Completed</span>
                <Mono className="font-medium text-[var(--ready)]">{new Date(task.completed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Mono>
              </div>
            )}
          </div>

          {(task.status === 'open' || task.status === 'in_progress') && (
            <div>
              <p className="text-xs font-medium text-ink3 mb-2">Update Status</p>
              <div className="flex gap-2">
                {task.status === 'open' && (
                  <button onClick={() => onStatusChange(task.id, 'in_progress')} disabled={updating} className="flex-1 py-2 text-sm font-medium bg-[var(--caution)] text-white rounded-lg disabled:opacity-50 transition-colors">Start Task</button>
                )}
                {task.status === 'in_progress' && !showCompleteForm && (
                  <button onClick={() => setShowCompleteForm(true)} disabled={updating} className="flex-1 py-2 text-sm font-medium bg-[var(--ready)] text-white rounded-lg disabled:opacity-50 transition-colors">Mark Complete</button>
                )}
                <button onClick={() => onStatusChange(task.id, 'cancelled')} disabled={updating} className="px-3 py-2 text-sm text-ink2 border border-[var(--line)] rounded-lg hover:bg-surface-3 disabled:opacity-50 transition-colors">Cancel</button>
              </div>
              {showCompleteForm && (
                <div className="mt-3 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-[var(--ready)]">Completion Notes (optional)</p>
                  <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} rows={2} className="w-full text-sm border border-[var(--line)] rounded-lg px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--ready)]/40 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => completeTask()} disabled={completing} className="flex-1 py-2 text-sm font-medium bg-[var(--ready)] text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-1">
                      {completing && <Loader2 size={12} className="animate-spin" />}Confirm Complete
                    </button>
                    <button onClick={() => { setShowCompleteForm(false); setCompleteNotes('') }} className="px-4 py-2 text-sm text-ink2 border border-[var(--line)] rounded-lg hover:bg-surface-3">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-ink3 mb-2">Comments {task.task_comments && task.task_comments.length > 0 && `(${task.task_comments.length})`}</p>
            {(!task.task_comments || task.task_comments.length === 0) && <p className="text-xs text-ink3 italic">No comments yet.</p>}
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
          {commentSuccess && <p className="text-xs text-[var(--ready)] mb-1.5">Comment added</p>}
          <div className="flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!submitting) handleComment() } }} placeholder="Add a comment..." aria-label="Add a comment" className="flex-1 text-sm px-3 py-2 bg-surface-2 border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40" />
            <button onClick={handleComment} disabled={submitting || !comment.trim()} className="p-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity">
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function TasksPageContent() {
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
  const [quickCapture, setQuickCapture] = useState('')

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
    onSuccess: (_, variables) => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); setSelectedTask((prev) => prev && prev.id === variables.taskId ? { ...prev, status: variables.status } : prev) },
  })

  const handleStatusChange = (taskId: string, status: TaskStatus) => updateStatus({ taskId, status })

  const handleComment = async (taskId: string, comment: string) => {
    await tasksApi.addComment(taskId, comment)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    const res = await tasksApi.get(taskId) as any
    if (res?.data) setSelectedTask(res.data)
  }

  const openCount = tasks.filter((t) => t.status === 'open').length
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
  const urgentCount = tasks.filter((t) => t.priority === 'urgent' && t.status !== 'completed' && t.status !== 'cancelled').length
  const aiCount = tasks.filter((t) => t.is_ai_created && t.status !== 'completed' && t.status !== 'cancelled').length

  const activeTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  const groups = groupTasks(activeTasks)

  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled')

  const assigneeCounts: Record<string, { name: string; count: number }> = {}
  for (const t of activeTasks) {
    if (t.user_profiles) {
      const id = t.assigned_to ?? 'unknown'
      const name = t.user_profiles.preferred_name ?? t.user_profiles.full_name ?? 'Unknown'
      if (!assigneeCounts[id]) assigneeCounts[id] = { name, count: 0 }
      assigneeCounts[id].count++
    }
  }
  const assigneeList = Object.values(assigneeCounts).sort((a, b) => b.count - a.count).slice(0, 6)
  const maxCount = assigneeList[0]?.count ?? 1

  const STATUS_TABS = [
    { value: 'all' as const, label: 'All' },
    { value: 'open' as const, label: 'Open' },
    { value: 'in_progress' as const, label: 'In Progress' },
    { value: 'completed' as const, label: 'Completed' },
    { value: 'cancelled' as const, label: 'Cancelled' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 mb-0.5">Operations</p>
          <h1 className="text-[22px] font-semibold text-ink leading-tight">Tasks</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {urgentCount > 0 && <Pill tone="alert" size="sm"><Clock size={9} /> <Mono>{urgentCount}</Mono> overdue</Pill>}
            {openCount > 0 && <Pill tone="caution" size="sm"><Mono>{openCount}</Mono> open</Pill>}
            {inProgressCount > 0 && <Pill tone="info" size="sm"><Mono>{inProgressCount}</Mono> in progress</Pill>}
            {aiCount > 0 && <Pill tone="ai" size="sm"><SparkIcon /> <Mono>{aiCount}</Mono> AI</Pill>}
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-opacity shrink-0">
          <Plus size={15} />New task
        </button>
      </div>

      <div className="flex flex-nowrap gap-1 border-b border-[var(--line)] overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`flex-shrink-0 whitespace-nowrap px-3.5 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              statusFilter === tab.value ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-ink3 hover:text-ink2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TaskType | '')} aria-label="Filter by type" className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none">
          <option value="">All Types</option>
          {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | '')} aria-label="Filter by priority" className="border border-[var(--line)] rounded-lg px-3 py-1.5 text-sm bg-surface text-ink2 focus:outline-none">
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-surface-2 rounded-lg animate-pulse" />)}</div>
      ) : tasks.length === 0 ? (
        <div className="bg-surface border border-[var(--line)] rounded-[var(--r-lg)] p-12 text-center">
          <ClipboardList size={36} className="mx-auto text-ink4 mb-3" />
          <p className="text-ink2 font-medium">No tasks found</p>
          <p className="text-sm text-ink3 mt-1">Create a task or use AI Copilot for natural language</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 mx-auto">
            <Plus size={14} />New Task
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-5 min-w-0">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center gap-2 pb-2 mb-1.5 border-b border-dashed border-[var(--line-2)]">
                  <StatusDot tone={group.tone} />
                  <h3 className="text-[13px] font-semibold text-ink">{group.label}</h3>
                  <Mono className="text-[11px] text-ink3">{group.items.length}</Mono>
                </div>
                <div>
                  {group.items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isOverdue={group.label === 'Overdue'}
                      onOpen={(t) => { setDrawerEditMode(false); setSelectedTask(t) }}
                      onStatusChange={handleStatusChange}
                      onEdit={(t) => { setDrawerEditMode(true); setSelectedTask(t) }}
                      onDelete={setDeleteTarget}
                      updating={updating}
                    />
                  ))}
                </div>
              </div>
            ))}
            {statusFilter === 'all' && completedTasks.length > 0 && groups.length === 0 && (
              <div>
                <div className="flex items-center gap-2 pb-2 mb-1.5 border-b border-dashed border-[var(--line-2)]">
                  <StatusDot tone="neutral" />
                  <h3 className="text-[13px] font-semibold text-ink">Completed</h3>
                  <Mono className="text-[11px] text-ink3">{completedTasks.length}</Mono>
                </div>
                <div>
                  {completedTasks.slice(0, 10).map((task) => (
                    <TaskRow key={task.id} task={task} isOverdue={false} onOpen={(t) => { setDrawerEditMode(false); setSelectedTask(t) }} onStatusChange={handleStatusChange} onEdit={(t) => { setDrawerEditMode(true); setSelectedTask(t) }} onDelete={setDeleteTarget} updating={updating} />
                  ))}
                </div>
              </div>
            )}
            {statusFilter !== 'all' && tasks.length > 0 && (
              <div>
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} isOverdue={false} onOpen={(t) => { setDrawerEditMode(false); setSelectedTask(t) }} onStatusChange={handleStatusChange} onEdit={(t) => { setDrawerEditMode(true); setSelectedTask(t) }} onDelete={setDeleteTarget} updating={updating} />
                ))}
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-3.5">
            <div className="bg-surface border border-[var(--line)] rounded-[var(--r-lg)] p-4">
              <SectionLabel>Quick capture</SectionLabel>
              <div className="bg-surface-2 border border-[var(--line)] rounded-[10px] px-3 py-2.5 text-[13px] text-ink3 mb-2.5 min-h-[40px]">
                <textarea
                  value={quickCapture}
                  onChange={(e) => setQuickCapture(e.target.value)}
                  placeholder="Type or speak — AI parses to a task..."
                  rows={2}
                  className="w-full bg-transparent text-ink text-[13px] placeholder:text-ink3 resize-none focus:outline-none"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { if (quickCapture.trim()) { setShowCreate(true) } }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold bg-[var(--ai)] text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                  <SparkIcon />Parse
                </button>
                <button className="px-3 py-1.5 text-xs font-medium border border-[var(--line)] text-ink2 rounded-lg hover:bg-surface-3 transition-colors flex items-center gap-1">
                  <Mic size={11} />Voice
                </button>
              </div>
              <p className="mt-2.5 text-[11px] text-ink3 leading-[1.5]">
                Try: <em>"have Diego clean the pool filter tomorrow morning before 8"</em>
              </p>
            </div>

            {assigneeList.length > 0 && (
              <div className="bg-surface border border-[var(--line)] rounded-[var(--r-lg)] overflow-hidden">
                <div className="px-4 pt-3.5 pb-2.5">
                  <SectionLabel hint="Active">By assignee</SectionLabel>
                </div>
                {assigneeList.map((a, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-4 py-2 border-t border-[var(--line-2)]">
                    <span className="w-[22px] h-[22px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[9px] font-bold flex items-center justify-center uppercase shrink-0">
                      {a.name.slice(0, 2)}
                    </span>
                    <span className="text-[12.5px] text-ink flex-1 truncate">{a.name}</span>
                    <div className="w-20">
                      <Bar value={a.count} max={maxCount} tone="accent" height={3} />
                    </div>
                    <Mono className="text-[11px] text-ink3">{a.count}</Mono>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {showCreate && (
        <CreateTaskModal onClose={() => setShowCreate(false)} onCreate={async (data) => { await createTask(data) }} creating={creating} />
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
        title={`Delete "${deleteTarget?.title ?? 'Task'}"`}
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
