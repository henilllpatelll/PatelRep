'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send } from 'lucide-react'
import type { Task } from '@/lib/api/tasks'
import { IconButton } from '@/components/ui/Button'

function authorName(comment: { user_profiles?: { preferred_name?: string | null; full_name?: string | null } | null }, t: ReturnType<typeof useTranslation>['t']): string {
  return comment.user_profiles?.preferred_name ?? comment.user_profiles?.full_name ?? t('tasks.detail.unknownAuthor')
}

/** Comment list + composer for the Comments tab — extracted so TaskDetailDrawer stays under the file-size guideline. */
export function TaskCommentsPanel({ task, onComment }: {
  task: Task
  onComment: (taskId: string, comment: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [commentSuccess, setCommentSuccess] = useState(false)
  const [commentError, setCommentError] = useState(false)

  const sortedComments = [...(task.task_comments ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const handleComment = async () => {
    if (!comment.trim()) return
    setSubmitting(true)
    setCommentError(false)
    try {
      await onComment(task.id, comment.trim())
      setComment('')
      setCommentSuccess(true)
      setTimeout(() => setCommentSuccess(false), 2000)
    } catch {
      setCommentError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-5">
        {sortedComments.length === 0 && (
          <p className="text-xs italic text-ink3">{t('tasks.detail.noComments')}</p>
        )}
        {sortedComments.map((c) => (
          <div key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.is_system ? 'bg-surface-2 text-ink3 italic' : 'bg-[var(--info-soft)] text-ink'}`}>
            {!c.is_system && <p className="text-xs font-semibold text-ink2">{authorName(c, t)}</p>}
            <p className="mt-0.5">{c.comment}</p>
            <p className="mt-0.5 text-xs text-ink3">{new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] p-4">
        {commentSuccess && <p className="mb-1.5 text-xs text-[var(--ready)]">{t('tasks.detail.commentAdded')}</p>}
        {commentError && <p className="mb-1.5 text-xs text-[var(--alert)]">{t('tasks.detail.commentFailed')}</p>}
        <div className="flex gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!submitting) handleComment() } }}
            placeholder={t('tasks.detail.commentPlaceholder')}
            aria-label={t('tasks.detail.commentAria')}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[var(--line)] bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
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
  )
}
