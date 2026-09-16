'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Send, Pencil } from 'lucide-react'
import { tasksApi, type Task, type TaskStatus, type TaskType, type Priority } from '@/lib/api/tasks'
import { Pill, AILabel, Mono } from '@/components/ui/primitives'
import { Button, IconButton } from '@/components/ui/Button'
import { getTaskTypeOptions, getTaskTypeLabels, getPriorityOptions, priorityTone, taskTypeIcon } from './taskDisplay'

export function TaskDetailDrawer({ task, onClose, onStatusChange, onComment, onSaved, updating, startInEditMode }: {
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
                {(task.status === 'in_progress' || task.status === 'escalated') && !showCompleteForm && (
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
