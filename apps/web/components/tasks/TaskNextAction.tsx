'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StaffMember } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import type { TaskCapabilities } from '@/lib/utils/taskCapabilities'
import { getTaskAssignmentAction, getTaskNextAction, type TaskNextActionKey } from '@/lib/utils/taskNextAction'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { Button } from '@/components/ui/Button'
import { StaffOptionRow } from '@/components/tasks/AssigneePicker'

export interface TaskNextActionContext {
  capabilities: TaskCapabilities
  role: UserRole | null
  staff: StaffMember[]
  workloadByAssignee: Map<string, number>
  pendingAction?: { itemId: string; key: TaskNextActionKey } | null
  onAction: (item: UnifiedTaskItem, key: TaskNextActionKey, note?: string) => void
  onAssign: (item: UnifiedTaskItem, staff: StaffMember) => void
}

function AssignmentMenu({ item, actionKey, context }: { item: UnifiedTaskItem; actionKey: 'assign' | 'reassign'; context: TaskNextActionContext }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pending = context.pendingAction?.itemId === item.id && context.pendingAction.key === actionKey
  const staff = useMemo(() => context.staff.filter((member) => member.full_name.toLowerCase().includes(query.trim().toLowerCase())), [context.staff, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant={actionKey === 'assign' ? 'primary' : 'outline'}
        loading={pending}
        aria-expanded={open}
        aria-haspopup="menu"
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() } }}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
      >
        {t(actionKey === 'assign' ? 'tasks.actions.assign' : 'tasks.actions.reassign')}
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('tasks.actions.assignTo')}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}
          className="absolute right-0 z-30 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-[var(--r-md)] border border-line bg-surface p-2 shadow-pop"
        >
          <p className="px-2 pb-1.5 text-xs font-semibold text-ink2">{t('tasks.actions.assignTo')}</p>
          {context.staff.length > 7 && <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('tasks.actions.searchStaff')} aria-label={t('tasks.actions.searchStaff')} className="mb-2 w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" />}
          <div className="max-h-52 overflow-y-auto">
            {staff.length === 0 ? <p className="px-2 py-2 text-xs text-ink3">{t('tasks.actions.noActiveStaff')}</p> : staff.map((member) => (
              <button key={member.user_id} type="button" role="menuitem" disabled={pending} onClick={() => { context.onAssign(item, member); close() }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50">
                <StaffOptionRow member={member} activeCount={context.workloadByAssignee.get(member.user_id) ?? 0} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Shared card/row control: one primary lifecycle action plus a lightweight assignment control when appropriate. */
export function TaskNextAction({ item, context }: { item: UnifiedTaskItem; context: TaskNextActionContext }) {
  const { t } = useTranslation()
  const [completeOpen, setCompleteOpen] = useState(false)
  const [note, setNote] = useState('')
  const next = getTaskNextAction(item, context.capabilities, context.role)
  const assignment = getTaskAssignmentAction(item, context.capabilities)
  const isPending = (key: TaskNextActionKey) => context.pendingAction?.itemId === item.id && context.pendingAction.key === key
  const separateAssignment = assignment && assignment.key !== next?.key ? assignment : null

  if (!next && !separateAssignment) return null

  function execute(key: TaskNextActionKey) {
    if (key === 'complete') { setCompleteOpen(true); return }
    context.onAction(item, key)
  }

  return (
    <div className="relative flex flex-wrap items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
      {next?.key === 'assign' || next?.key === 'reassign' ? (
        <AssignmentMenu item={item} actionKey={next.key} context={context} />
      ) : next && (
        <Button type="button" size="sm" variant={next.key === 'complete' || next.key === 'verify' ? 'primary' : 'secondary'} loading={isPending(next.key)} onClick={() => execute(next.key)}>
          {t(next.labelKey)}
        </Button>
      )}
      {separateAssignment && <AssignmentMenu item={item} actionKey={separateAssignment.key as 'assign' | 'reassign'} context={context} />}
      {completeOpen && (
        <div role="dialog" aria-label={t('tasks.actions.completeTask')} onKeyDown={(event) => { if (event.key === 'Escape') setCompleteOpen(false) }} className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-[var(--r-md)] border border-line bg-surface p-3 shadow-pop">
          <p className="mb-2 text-sm font-semibold text-ink">{t('tasks.actions.completeTask')}</p>
          <label className="block text-xs font-medium text-ink2" htmlFor={`completion-note-${item.id}`}>{t('tasks.actions.completionNotes')}</label>
          <textarea id={`completion-note-${item.id}`} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full resize-none rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" rows={2} />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setCompleteOpen(false)}>{t('common.cancel')}</Button>
            <Button type="button" size="sm" loading={isPending('complete')} onClick={() => { context.onAction(item, 'complete', note.trim() || undefined); setCompleteOpen(false); setNote('') }}>{t('tasks.actions.complete')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
