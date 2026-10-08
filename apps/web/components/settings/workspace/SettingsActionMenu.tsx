'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActionMenuItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  tone?: 'default' | 'destructive'
  disabled?: boolean
  /** Why the action is unavailable; shown under the label when disabled. */
  disabledReason?: string
}

/** "More actions" menu button (WAI-ARIA menu button): Arrow keys move, Escape/Tab/outside click close, focus returns to the trigger. */
export function SettingsActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const enabled = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])

  useEffect(() => {
    if (!open) return
    enabled()[0]?.focus()
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = enabled()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); list[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); list[list.length - 1]?.focus() }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
    else if (event.key === 'Tab') close(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true) } }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:h-9 sm:w-9"
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-dropdown mt-1 w-56 rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              onClick={() => { if (item.disabled) return; close(false); item.onSelect() }}
              className={cn(
                'flex min-h-[40px] w-full items-start gap-2 rounded-[var(--r-sm)] px-3 py-2 text-left text-sm focus-visible:bg-surface-2 focus-visible:outline-none',
                item.disabled ? 'cursor-not-allowed text-ink-3' : item.tone === 'destructive' ? 'text-[var(--alert)] hover:bg-[var(--alert-soft)] focus-visible:bg-[var(--alert-soft)]' : 'text-ink hover:bg-surface-2',
              )}
            >
              {item.icon && <span aria-hidden="true" className="mt-0.5 shrink-0">{item.icon}</span>}
              <span>
                {item.label}
                {item.disabled && item.disabledReason && <span className="mt-0.5 block text-xs font-normal text-ink-3">{item.disabledReason}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
