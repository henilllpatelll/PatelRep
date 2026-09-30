'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreVertical, Send } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { StaffMember } from '@/lib/api/staff'
import { logbookApi, type LogbookComment } from '@/lib/api/logbook'
import { IconButton } from '@/components/ui/Button'

function nameOf(person: { preferred_name?: string | null; full_name?: string | null }) { return person.preferred_name || person.full_name || 'Team member' }

export function LogbookCommentsPanel({ entryId, staff, currentUserId, canDeleteAny, onChanged }: { entryId: string; staff: StaffMember[]; currentUserId: string; canDeleteAny: boolean; onChanged: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [content, setContent] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [editing, setEditing] = useState<LogbookComment | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [caretPos, setCaretPos] = useState(0)
  const commentsQuery = useQuery({ queryKey: ['logbook-comments', entryId], queryFn: () => logbookApi.listComments(entryId), select: (result) => result.data })
  const comments = commentsQuery.data ?? []
  const fragment = content.slice(0, caretPos).match(/@([^@\s]*)$/)?.[1]?.toLowerCase() ?? ''
  const candidates = useMemo(() => staff.filter((member) => member.user_id !== currentUserId && member.full_name.toLowerCase().includes(fragment)).slice(0, 6), [fragment, staff, currentUserId])
  const refresh = () => { client.invalidateQueries({ queryKey: ['logbook-comments', entryId] }); onChanged() }
  const create = useMutation({ mutationFn: () => logbookApi.createComment(entryId, { content: content.trim(), mentioned_user_ids: mentionIds }), onSuccess: () => { setContent(''); setMentionIds([]); refresh() } })
  const update = useMutation({ mutationFn: () => logbookApi.updateComment(editing!.id, { content: content.trim(), mentioned_user_ids: mentionIds }), onSuccess: () => { setEditing(null); setContent(''); setMentionIds([]); refresh() } })
  const remove = useMutation({ mutationFn: (id: string) => logbookApi.deleteComment(id), onSuccess: refresh })
  function chooseMention(person: StaffMember) {
    const at = ref.current?.selectionStart ?? content.length
    const before = content.slice(0, at).replace(/@[^@\s]*$/, `@${person.full_name} `)
    setContent(`${before}${content.slice(at)}`)
    setCaretPos(before.length)
    setMentionIds((ids) => ids.includes(person.user_id) ? ids : [...ids, person.user_id])
    setMentionOpen(false)
    requestAnimationFrame(() => ref.current?.focus())
  }
  function submit() { if (!content.trim() || create.isPending || update.isPending) return; editing ? update.mutate() : create.mutate() }
  return <div className="flex h-full min-h-[420px] flex-col">
    <div className="flex-1 space-y-3 overflow-y-auto p-5">
      {commentsQuery.isLoading ? <p className="text-sm text-ink3">{t('common.loading')}</p> : comments.length === 0 ? <p className="text-sm italic text-ink3">{t('logbook.noComments')}</p> : comments.map((comment) => {
        const canManage = comment.author_id === currentUserId || canDeleteAny
        return <article key={comment.id} className="rounded-[var(--r-md)] bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-ink">{nameOf(comment.author)}</p><p className="text-xs text-ink3">{format(new Date(comment.created_at), 'MMM d · h:mm a')}{comment.edited_at ? ` · ${t('logbook.edited')}` : ''}</p></div>{canManage && <div className="flex items-center"><IconButton variant="ghost" size="sm" aria-label={t('logbook.editComment')} disabled={comment.author_id !== currentUserId} onClick={() => { setEditing(comment); setContent(comment.content); setMentionIds([]) }}><MoreVertical size={15} /></IconButton><button type="button" onClick={() => { if (confirm(t('logbook.deleteCommentConfirm'))) remove.mutate(comment.id) }} className="text-xs text-[var(--alert)]">{t('common.delete')}</button></div>}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{comment.content}</p>
        </article>
      })}
    </div>
    <div className="relative shrink-0 border-t border-line p-4">
      {mentionOpen && candidates.length > 0 && <div role="listbox" className="absolute bottom-[76px] left-4 right-4 z-20 rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-pop">{candidates.map((person, index) => <button key={person.user_id} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => { event.preventDefault(); chooseMention(person) }} className={`block w-full rounded px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2'}`}><span className="font-medium text-ink">{person.full_name}</span><span className="ml-2 text-xs text-ink3">{person.role.replace('_', ' ')}</span></button>)}</div>}
      {editing && <div className="mb-2 flex items-center justify-between text-xs text-ink3"><span>{t('logbook.editComment')}</span><button type="button" onClick={() => { setEditing(null); setContent(''); setMentionIds([]) }} className="text-accent">{t('common.cancel')}</button></div>}
      <div className="flex gap-2"><textarea ref={ref} value={content} rows={2} onChange={(event) => { setContent(event.target.value); setCaretPos(event.target.selectionStart); setMentionOpen(/@[^@\s]*$/.test(event.target.value.slice(0, event.target.selectionStart))); setActiveIndex(0) }} onSelect={(event) => setCaretPos(event.currentTarget.selectionStart)} onClick={(event) => setCaretPos(event.currentTarget.selectionStart)} onKeyUp={(event) => setCaretPos(event.currentTarget.selectionStart)} onKeyDown={(event) => { if (mentionOpen && candidates.length) { if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => (i + 1) % candidates.length) } else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => (i + candidates.length - 1) % candidates.length) } else if (event.key === 'Enter') { event.preventDefault(); chooseMention(candidates[activeIndex]) } else if (event.key === 'Escape') setMentionOpen(false) } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder={t('logbook.addCommentPlaceholder')} aria-label={t('logbook.addCommentPlaceholder')} className="min-h-10 flex-1 resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm" /><IconButton variant="primary" loading={create.isPending || update.isPending} disabled={!content.trim()} onClick={submit} aria-label={t('logbook.sendComment')}><Send size={15} /></IconButton></div>
    </div>
  </div>
}
