'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ClipboardList, Clock, Bot, Bed, Wrench, Users, HelpCircle,
  X, Send, Loader2, Pencil,
} from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type TaskType, type Priority, type CreateTaskData } from '@/lib/api/tasks'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS: Array<{ value: 'all' | TaskStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function taskTypeIcon(t: TaskType) {
  if (t === 'housekeeping') return <Bed size={14} className="shrink-0" />
  if (t === 'engineering') return <Wrench size={14} className="shrink-0" />
  if (t === 'guest_request') return <Users size={14} className="shrink-0" />
  return <HelpCircle size={14} className="shrink-0" />
}

function priorityBadge(p: Priority) {
  const styles: Record<Priority, string> = {
    urgent: 'bg-red-100 text-red-700',
    normal: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${styles[p]}`}>
      {p}
    </span>
  )
}

function statusBadge(s: TaskStatus) {
  const styles: Record<TaskStatus, string> = {
    open: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-400',
  }
  const labels: Record<TaskStatus, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[s]}`}>
      {labels[s]}
    </span>
  )
}

function priorityStripe(p: Priority) {
  if (p === 'urgent') return 'border-l-4 border-l-red-500'
  if (p === 'normal') return 'border-l-4 border-l-amber-400'
  return 'border-l-4 border-l-gray-200'
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

function SlaIndicator({ task }: { task: Task }) {
  if (!task.due_at || task.status === 'completed' || task.status === 'cancelled') return null
  const now = Date.now()
  const due = new Date(task.due_at).getTime()
  const diffMin = Math.round((due - now) / 60000)

  if (diffMin < 0) {
    return (
      <span className="text-xs text-red-600 font-medium flex items-center gap-1">
        <Clock size={10} />Overdue {formatDuration(diffMin)}
      </span>
    )
  }
  if (diffMin < 30) {
    return (
      <span className="text-xs text-orange-600 font-medium flex items-center gap-1">
        <Clock size={10} />{formatDuration(diffMin)} left
      </span>
    )
  }
  return (
    <span className="text-xs text-gray-400 flex items-center gap-1">
      <Clock size={10} />
      Due {new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task
  onOpen: (t: Task) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  onEdit: (t: Task) => void
  onDelete: (t: Task) => void
  updating: boolean
}

function TaskCard({ task, onOpen, onStatusChange, onEdit, onDelete, updating }: TaskCardProps) {
  return (
    <div
      className={`bg-white/[0.65] border border-white/90 backdrop-blur-md rounded-2xl ${priorityStripe(task.priority)} cursor-pointer hover:shadow-md transition-shadow`}
      onClick={() => onOpen(task)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-gray-400">{taskTypeIcon(task.task_type)}</span>
              <span className="text-xs text-gray-400">{TASK_TYPE_LABELS[task.task_type]}</span>
              {task.is_ai_created && (
                <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <Bot size={10} />AI
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 leading-snug">{task.title}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {task.rooms && <span className="text-xs text-gray-500">Room {task.rooms.room_number}</span>}
              {task.location_text && !task.rooms && <span className="text-xs text-gray-500">{task.location_text}</span>}
              {task.user_profiles && (
                <span className="text-xs text-gray-500">→ {task.user_profiles.preferred_name}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {priorityBadge(task.priority)}
            {statusBadge(task.status)}
            <KebabMenu onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50">
          <SlaIndicator task={task} />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {task.status === 'open' && (
              <button
                onClick={() => onStatusChange(task.id, 'in_progress')}
                disabled={updating}
                className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Start
              </button>
            )}
            {task.status === 'in_progress' && (
              <button
                onClick={() => onStatusChange(task.id, 'completed')}
                disabled={updating}
                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Complete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Create Task Modal ─────────────────────────────────────────────────────────

interface CreateTaskModalProps {
  onClose: () => void
  onCreate: (data: CreateTaskData) => Promise<void>
  creating: boolean
}

function CreateTaskModal({ onClose, onCreate, creating }: CreateTaskModalProps) {
  const [form, setForm] = useState<CreateTaskData>({
    title: '',
    task_type: 'general',
    priority: 'normal',
    description: '',
    location_text: '',
  })
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof CreateTaskData, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setError(null)
    try {
      await onCreate({
        ...form,
        description: form.description || undefined,
        location_text: form.location_text || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 className="text-lg font-semibold text-gray-900">New Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Title *</label>
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Fix leaking faucet in Room 302"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label>
              <select
                value={form.task_type}
                onChange={(e) => set('task_type', e.target.value as TaskType)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => set('priority', e.target.value as Priority)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Location (optional)</label>
            <input
              value={form.location_text}
              onChange={(e) => set('location_text', e.target.value)}
              placeholder="e.g. Room 302, Lobby, Pool area"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="Additional details..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 justify-center">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={creating || !form.title.trim()} className="flex-1 justify-center">
              {creating && <Loader2 size={14} className="animate-spin" />}
              Create Task
            </Button>
          </div>

          <p className="text-xs text-gray-400 text-center">
            Tip: Use the AI Copilot to create tasks from natural language
          </p>
        </form>
      </div>
    </div>
  )
}

// ── Task Detail Drawer ────────────────────────────────────────────────────────

interface TaskDetailDrawerProps {
  task: Task
  onClose: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  onComment: (taskId: string, comment: string) => Promise<void>
  onSaved: (updated: Task) => void
  updating: boolean
  startInEditMode?: boolean
}

function TaskDetailDrawer({ task, onClose, onStatusChange, onComment, onSaved, updating, startInEditMode }: TaskDetailDrawerProps) {
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
    try {
      await onComment(task.id, comment.trim())
      setComment('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/10 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-white/[0.88] backdrop-blur-2xl border-l border-white/[0.95] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">{taskTypeIcon(task.task_type)}</span>
            <h2 className="font-semibold text-gray-900 text-sm">Task Details</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsEditing((v) => !v)} className="text-gray-400 hover:text-gray-600 p-1" title="Edit">
              <Pencil size={15} />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Inline edit form */}
          {isEditing && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-800">Edit Task</p>
              <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50" placeholder="Title" />
              <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none" placeholder="Description (optional)" />
              <div className="grid grid-cols-2 gap-2">
                <select value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as Priority }))} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50">
                  <option value="urgent">Urgent</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
                <select value={editForm.task_type} onChange={(e) => setEditForm((f) => ({ ...f, task_type: e.target.value as TaskType }))} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50">
                  {TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <input value={editForm.location_text} onChange={(e) => setEditForm((f) => ({ ...f, location_text: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50" placeholder="Location" />
              <div className="flex gap-2">
                <button onClick={() => saveEdit()} disabled={saving || !editForm.title.trim()} className="flex-1 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-1">
                  {saving && <Loader2 size={12} className="animate-spin" />}Save
                </button>
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          {/* Title + badges */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {priorityBadge(task.priority)}
              {statusBadge(task.status)}
              {task.is_ai_created && (
                <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <Bot size={10} />AI created
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-gray-900">{task.title}</h3>
            {task.description && (
              <p className="text-sm text-gray-500 mt-1">{task.description}</p>
            )}
          </div>

          {/* Meta */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 text-sm">
            {task.rooms && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Room</span>
                <span className="font-medium text-gray-900">{task.rooms.room_number}</span>
              </div>
            )}
            {task.location_text && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Location</span>
                <span className="font-medium text-gray-900">{task.location_text}</span>
              </div>
            )}
            {task.user_profiles && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Assigned to</span>
                <span className="font-medium text-gray-900">{task.user_profiles.preferred_name}</span>
              </div>
            )}
            {task.due_at && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Due</span>
                <span className="font-medium text-gray-900">
                  {new Date(task.due_at).toLocaleString([], {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Created</span>
              <span className="font-medium text-gray-900">
                {new Date(task.created_at).toLocaleString([], {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
            {task.started_at && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Started</span>
                <span className="font-medium text-gray-900">
                  {new Date(task.started_at).toLocaleString([], {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            )}
            {task.completed_at && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Completed</span>
                <span className="font-medium text-green-700">
                  {new Date(task.completed_at).toLocaleString([], {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            )}
            {task.ai_confidence !== undefined && task.ai_confidence !== null && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">AI confidence</span>
                <span className="font-medium text-gray-900">{Math.round(task.ai_confidence * 100)}%</span>
              </div>
            )}
          </div>

          {/* Status actions */}
          {(task.status === 'open' || task.status === 'in_progress') && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Update Status</p>
              <div className="flex gap-2">
                {task.status === 'open' && (
                  <button
                    onClick={() => onStatusChange(task.id, 'in_progress')}
                    disabled={updating}
                    className="flex-1 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    Start Task
                  </button>
                )}
                {task.status === 'in_progress' && !showCompleteForm && (
                  <button
                    onClick={() => setShowCompleteForm(true)}
                    disabled={updating}
                    className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    Mark Complete
                  </button>
                )}
                <button
                  onClick={() => onStatusChange(task.id, 'cancelled')}
                  disabled={updating}
                  className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {showCompleteForm && (
                <div className="mt-3 bg-green-50/60 border border-green-200/60 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-green-800">Completion Notes (optional)</p>
                  <textarea
                    value={completeNotes}
                    onChange={(e) => setCompleteNotes(e.target.value)}
                    rows={2}
                    placeholder="What was done? Any follow-up needed?"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400/50 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => completeTask()}
                      disabled={completing}
                      className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {completing && <Loader2 size={12} className="animate-spin" />}
                      Confirm Complete
                    </button>
                    <button
                      onClick={() => { setShowCompleteForm(false); setCompleteNotes('') }}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comments */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">
              Comments {task.task_comments && task.task_comments.length > 0 && `(${task.task_comments.length})`}
            </p>
            {(!task.task_comments || task.task_comments.length === 0) && (
              <p className="text-xs text-gray-400 italic">No comments yet.</p>
            )}
            <div className="space-y-2">
              {task.task_comments?.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    c.is_system ? 'bg-gray-50 text-gray-500 italic' : 'bg-blue-50 text-gray-800'
                  }`}
                >
                  <p>{c.comment}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(c.created_at).toLocaleString([], {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Comment input */}
        <div className="p-4 border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleComment()
                }
              }}
              placeholder="Add a comment..."
              className="flex-1 text-sm px-3 py-2 bg-white/70 border border-amber-200/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200"
            />
            <button
              onClick={handleComment}
              disabled={submitting || !comment.trim()}
              className="p-2 bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [typeFilter, setTypeFilter] = useState<TaskType | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerEditMode, setDrawerEditMode] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)

  const { mutate: deleteTask, isPending: deleting } = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setDeleteTarget(null)
      setSelectedTask(null)
    },
  })

  const filters = {
    ...(statusFilter !== 'all' && { status: statusFilter as TaskStatus }),
    ...(typeFilter && { task_type: typeFilter as TaskType }),
    ...(priorityFilter && { priority: priorityFilter as Priority }),
    per_page: 50,
  }

  const { data: response, isLoading } = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => tasksApi.list(filters),
  })
  const tasks: Task[] = (response as any)?.data ?? []

  const { mutateAsync: createTask, isPending: creating } = useMutation({
    mutationFn: (data: CreateTaskData) => tasksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setShowCreate(false)
    },
  })

  const { mutate: updateStatus, isPending: updating } = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      tasksApi.update(taskId, { status }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setSelectedTask((prev) => prev && prev.id === variables.taskId ? { ...prev, status: variables.status } : prev)
    },
  })

  const handleStatusChange = (taskId: string, status: TaskStatus) => {
    updateStatus({ taskId, status })
  }

  const handleComment = async (taskId: string, comment: string) => {
    await tasksApi.addComment(taskId, comment)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    const res = await tasksApi.get(taskId) as any
    if (res?.data) setSelectedTask(res.data)
  }

  const openCount = tasks.filter((t) => t.status === 'open').length
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
  const urgentCount = tasks.filter(
    (t) => t.priority === 'urgent' && t.status !== 'completed' && t.status !== 'cancelled'
  ).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {openCount} open · {inProgressCount} in progress
            {urgentCount > 0 && <span className="text-red-600"> · {urgentCount} urgent</span>}
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} />
          New Task
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TaskType | '')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        >
          <option value="">All Types</option>
          {TASK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | '')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        >
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card className="p-12 text-center">
          <ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No tasks found</p>
          <p className="text-sm text-gray-400 mt-1">
            Create a task manually or use the AI Copilot to create from natural language
          </p>
          <Button variant="primary" onClick={() => setShowCreate(true)} className="mt-4">
            <Plus size={14} />New Task
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={(t) => { setDrawerEditMode(false); setSelectedTask(t) }}
              onStatusChange={handleStatusChange}
              onEdit={(t) => { setDrawerEditMode(true); setSelectedTask(t) }}
              onDelete={setDeleteTarget}
              updating={updating}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={async (data) => { await createTask(data) }}
          creating={creating}
        />
      )}

      {/* Task Detail Drawer */}
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

      {/* Delete Confirm */}
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
