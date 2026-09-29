'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, ChevronDown, Pencil, Save, Star, Trash2 } from 'lucide-react'
import type { SavedTaskView } from '@/lib/utils/taskViews'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

export function SavedViewsMenu({
  views, activeViewId, onApply, onSaveCurrent, onRename, onDelete, onSetDefault,
}: {
  views: SavedTaskView[]
  activeViewId: string | null
  onApply: (view: SavedTaskView) => void
  onSaveCurrent: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [managing, setManaging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const activeView = views.find((v) => v.id === activeViewId)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    setManaging(false)
    setSaving(false)
    setRenamingId(null)
  }

  function submitSave(event: React.FormEvent) {
    event.preventDefault()
    if (!draftName.trim()) return
    onSaveCurrent(draftName.trim())
    setDraftName('')
    setSaving(false)
  }

  function submitRename(event: React.FormEvent) {
    event.preventDefault()
    if (!renamingId || !renameDraft.trim()) return
    onRename(renamingId, renameDraft.trim())
    setRenamingId(null)
  }

  return (
    <div className="relative flex items-center gap-1.5" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); close() } }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <Bookmark size={14} />
        <span className="max-w-[140px] truncate">{activeView ? activeView.name : t('tasks.views.menuLabel')}</span>
        <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div ref={menuRef} role="menu" className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-[var(--r-md)] border border-line bg-surface p-2 shadow-pop">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <p className="text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('tasks.views.heading')}</p>
            <button type="button" onClick={() => setManaging((v) => !v)} className="text-xs font-medium text-accent">
              {managing ? t('tasks.views.doneManaging') : t('tasks.views.manageViews')}
            </button>
          </div>

          {views.length === 0 ? (
            <p className="px-1 py-3 text-xs text-ink3">{t('tasks.views.empty')}</p>
          ) : (
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {views.map((view) => (
                <div key={view.id} className="group flex items-center gap-1">
                  {renamingId === view.id ? (
                    <form onSubmit={submitRename} className="flex flex-1 items-center gap-1 py-0.5">
                      <Input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} aria-label={t('tasks.views.renameAria')} className="h-8 text-sm" />
                      <Button type="submit" size="sm" variant="ghost">{t('common.save', 'Save')}</Button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onApply(view); close() }}
                        className={cn('flex-1 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]', view.id === activeViewId ? 'bg-[var(--accent-soft)] text-accent font-medium' : 'text-ink')}
                      >
                        {view.name}
                      </button>
                      {managing && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton type="button" size="sm" variant="ghost" aria-label={t('tasks.views.setDefaultAria', { name: view.name })} aria-pressed={view.isDefault} onClick={() => onSetDefault(view.isDefault ? null : view.id)}>
                            <Star size={13} className={view.isDefault ? 'fill-current text-[var(--caution)]' : ''} />
                          </IconButton>
                          <IconButton type="button" size="sm" variant="ghost" aria-label={t('tasks.views.renameAria')} onClick={() => { setRenamingId(view.id); setRenameDraft(view.name) }}>
                            <Pencil size={13} />
                          </IconButton>
                          <IconButton type="button" size="sm" variant="ghost" aria-label={t('tasks.views.deleteAria', { name: view.name })} onClick={() => onDelete(view.id)}>
                            <Trash2 size={13} />
                          </IconButton>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-1.5 border-t border-line pt-1.5">
            {saving ? (
              <form onSubmit={submitSave} className="flex items-center gap-1.5 px-1 py-0.5">
                <Input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={t('tasks.views.namePlaceholder')} aria-label={t('tasks.views.namePlaceholder')} className="h-8 flex-1 text-sm" />
                <Button type="submit" size="sm" disabled={!draftName.trim()}>{t('common.save', 'Save')}</Button>
              </form>
            ) : (
              <button type="button" onClick={() => setSaving(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium text-accent hover:bg-surface-2">
                <Save size={14} />{t('tasks.views.saveCurrentView')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
