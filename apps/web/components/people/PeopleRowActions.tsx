'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DirectoryEntry, InvitationEntry, StaffEntry } from '@/lib/people/peopleDirectory'
import { usePeopleLabels } from './usePeopleLabels'

export interface RowActionHandlers {
  onEdit: (entry: StaffEntry) => void
  onDeactivate: (entry: StaffEntry) => void
  onReactivate: (entry: StaffEntry) => void
  onResend: (entry: InvitationEntry) => void
  onRevoke: (entry: InvitationEntry) => void
}

interface MenuItem {
  id: string
  label: string
  destructive?: boolean
  run: () => void
}

/** Only actions that really work today. Phase 3 drawers add profile/access/coverage entries here. */
function useRowMenuItems(entry: DirectoryEntry, h: RowActionHandlers): MenuItem[] {
  const { t } = usePeopleLabels()
  if (entry.kind === 'staff') {
    if (entry.status === 'active') {
      return [
        { id: 'edit', label: t('people.actions.edit'), run: () => h.onEdit(entry) },
        { id: 'deactivate', label: t('people.actions.deactivate'), destructive: true, run: () => h.onDeactivate(entry) },
      ]
    }
    return [{ id: 'reactivate', label: t('people.actions.reactivate'), run: () => h.onReactivate(entry) }]
  }
  return [
    { id: 'resend', label: t('people.actions.resend'), run: () => h.onResend(entry) },
    { id: 'revoke', label: t('people.actions.revoke'), destructive: true, run: () => h.onRevoke(entry) },
  ]
}

export function PeopleRowActions({
  entry, name, handlers, busy,
}: { entry: DirectoryEntry; name: string; handlers: RowActionHandlers; busy?: boolean }) {
  const { t } = usePeopleLabels()
  const items = useRowMenuItems(entry, handlers)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  const toggle = () => {
    if (open) return close(false)
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      const menuHeight = items.length * 40 + 8
      const above = window.innerHeight - rect.bottom < menuHeight + 8
      setPos({ top: above ? rect.top - menuHeight - 4 : rect.bottom + 4, left: Math.max(8, rect.right - 208) })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false)
    }
    const onDismiss = () => close(false)
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [open, close])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Tab') close(false)
  }

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('people.actions.menu', { name })}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50 lg:h-8 lg:w-8"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('people.actions.menu', { name })}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-50 w-52 rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => { close(false); item.run() }}
              className={cn(
                'flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-[13px] font-medium hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
                item.destructive ? 'text-[var(--alert)]' : 'text-ink-2',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
