'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { TaskType, Priority, CreateTaskData } from '@/lib/api/tasks'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { Button, IconButton } from '@/components/ui/Button'
import { getTaskTypeOptions, getPriorityOptions } from './taskDisplay'

export function CreateTaskModal({ onClose, onCreate, creating }: {
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
