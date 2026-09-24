'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { roomsApi } from '@/lib/api/rooms'
import type { CreateTaskData, Priority, TaskType } from '@/lib/api/tasks'
import type { StaffMember } from '@/lib/api/staff'
import { Button, IconButton } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { getPriorityOptions, getTaskTypeOptions, taskTypeIcon } from './taskDisplay'
import { cn } from '@/lib/utils'

type Mode = 'internal' | 'guest'

// Mirrors apps/api/routers/tasks.py SLA_MINUTES — display-only hint, the
// backend is the source of truth for the actual due_at it sets.
const SLA_MINUTES: Record<Priority, number> = { urgent: 60, normal: 240, low: 480 }
function slaHintDuration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function CreateTaskDrawer({ isOpen, onClose, onCreateTask, onCreated, staff, canAssign, creating, initialTitle }: {
  isOpen: boolean; onClose: () => void; onCreateTask: (payload: CreateTaskData) => Promise<void>; onCreated: () => void
  staff: StaffMember[]; canAssign: boolean; creating: boolean; initialTitle?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>('internal')
  const [title, setTitle] = useState('')
  // Quick-add hands off its typed text as a starting title — the drawer is still
  // where room/type/priority/assignee get filled in, never a silent NL parse.
  useEffect(() => { if (isOpen && initialTitle) setTitle(initialTitle) }, [isOpen, initialTitle])
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TaskType>('general')
  const [priority, setPriority] = useState<Priority>('normal')
  const [assignedTo, setAssignedTo] = useState('')
  const [roomId, setRoomId] = useState('')
  const [error, setError] = useState<string | null>(null)
  useModalFocusTrap(ref, isOpen, onClose)

  const { data: roomsData } = useQuery({ queryKey: ['rooms-list-simple'], queryFn: () => roomsApi.list(), enabled: isOpen && mode === 'guest', staleTime: 60_000 })
  const rooms = ((roomsData as any)?.data ?? []) as Array<{ room_id: string; rooms?: { room_number?: string } }>
  const createGuest = useMutation({
    mutationFn: () => guestRequestsApi.createRequest({ title: title.trim().slice(0, 120), description: description.trim(), room_id: roomId || undefined, priority: priority === 'low' ? 'normal' : priority, category: type === 'engineering' ? 'maintenance' : type === 'housekeeping' ? 'housekeeping' : 'service' }),
    onSuccess: closeAndReset,
    onError: () => setError(t('tasks.workspace.createError')),
  })
  function closeAndReset() { setTitle(''); setLocation(''); setDescription(''); setRoomId(''); setAssignedTo(''); setError(null); onCreated(); onClose() }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim()) return; setError(null)
    if (mode === 'guest') { createGuest.mutate(); return }
    try { await onCreateTask({ title: title.trim(), description: description.trim() || undefined, location_text: location.trim() || undefined, task_type: type, priority, assigned_to: assignedTo || undefined }); closeAndReset() }
    catch { setError(t('tasks.workspace.createError')) }
  }
  if (!isOpen) return null
  const staffForType = [...staff].sort((a, b) => Number(b.role === (type === 'engineering' ? 'engineer' : 'housekeeper')) - Number(a.role === (type === 'engineering' ? 'engineer' : 'housekeeper')) || a.full_name.localeCompare(b.full_name))
  return <div className="fixed inset-0 z-50 flex justify-end"><button aria-label={t('tasks.createModal.closeAria')} className="absolute inset-0 bg-black/30" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="task-create-title" className="relative flex h-full w-full max-w-[540px] flex-col border-l border-line bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-ink3">{t('tasks.unified.eyebrow')}</p><h2 id="task-create-title" className="text-lg font-semibold text-ink">{t('tasks.workspace.createTitle')}</h2></div><IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.createModal.closeAria')}><X size={18}/></IconButton></div>
      <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-5"><div className="grid grid-cols-2 rounded-[var(--r-md)] bg-surface-2 p-1"><button type="button" onClick={() => setMode('internal')} className={`rounded px-3 py-2 text-sm font-medium ${mode === 'internal' ? 'bg-surface text-ink shadow-sm' : 'text-ink3'}`}>{t('tasks.unified.chooserInternalTitle')}</button><button type="button" onClick={() => setMode('guest')} className={`rounded px-3 py-2 text-sm font-medium ${mode === 'guest' ? 'bg-surface text-ink shadow-sm' : 'text-ink3'}`}>{t('tasks.unified.chooserGuestTitle')}</button></div>
        <div><label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.workspace.whatLabel')}</label><input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.workspace.whatPlaceholder')} className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" /></div>
        {mode === 'guest' ? <div><label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.detail.room')}</label><select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink"><option value="">{t('tasks.workspace.noRoom')}</option>{rooms.map((room) => <option key={room.room_id} value={room.room_id}>{room.rooms?.room_number}</option>)}</select></div> : <div><label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.workspace.whereLabel')}</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('tasks.createModal.locationPlaceholder')} className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></div>}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.createModal.typeLabel')}</label>
          <div className="flex flex-wrap gap-1.5">
            {getTaskTypeOptions(t).map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => setType(option.value)}
                aria-pressed={type === option.value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors',
                  type === option.value ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2'
                )}
              >
                {taskTypeIcon(option.value)}{option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.createModal.priorityLabel')}</label>
          <div className="flex gap-2">
            {getPriorityOptions(t).map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => setPriority(option.value)}
                aria-pressed={priority === option.value}
                className={cn(
                  'flex-1 rounded-[var(--r-md)] border py-2 text-[13px] font-semibold transition-colors',
                  priority === option.value
                    ? option.value === 'urgent'
                      ? 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]'
                      : 'bg-surface-3 border-ink3 text-ink'
                    : 'bg-surface border-line text-ink2 hover:bg-surface-2'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'internal' && (
          <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-xs text-ink3">
            {t('tasks.createModal.slaHint', { duration: slaHintDuration(SLA_MINUTES[priority]) })}
          </p>
        )}
        {mode === 'internal' && canAssign && <label className="block text-sm font-medium text-ink">{t('tasks.workspace.assignLabel')}<select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="mt-1.5 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm"><option value="">{type === 'housekeeping' ? t('tasks.createModal.unassignedHousekeeping') : t('tasks.createModal.unassigned')}</option>{staffForType.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}</select></label>}
        <div><label className="mb-1.5 block text-sm font-medium text-ink">{t('tasks.createModal.notesLabel')}</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></div>{error && <p className="text-sm text-[var(--alert)]">{error}</p>}</form>
      <div className="flex gap-3 border-t border-line p-4"><Button variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button><Button variant="primary" loading={creating || createGuest.isPending} disabled={!title.trim()} onClick={() => (document.querySelector('#task-create-title')?.closest('[role=dialog]')?.querySelector('form') as HTMLFormElement)?.requestSubmit()} className="flex-1">{t('tasks.createModal.create')}</Button></div>
    </div></div>
}
