'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Loader2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { cn } from '@/lib/utils'
import { Button, IconButton } from '@/components/ui/Button'
import { usePeopleLabels } from './usePeopleLabels'

// While any confirmation dialog is open the drawer's own focus trap / Escape handler stands down, so
// Escape closes only the dialog and Tab cannot escape into the layer underneath.
let openDialogs = 0
const dialogSubs = new Set<() => void>()
const setDialogOpen = (delta: 1 | -1) => { openDialogs += delta; dialogSubs.forEach((f) => f()) }
const subscribeDialogs = (f: () => void) => { dialogSubs.add(f); return () => { dialogSubs.delete(f) } }

interface ShellProps {
  eyebrow?: string
  title: string
  /** Changes whenever the drawer swaps to a different internal view, so focus moves to the new title. */
  viewKey: string
  onClose: () => void
  onBack?: () => void
  /** False while a confirmation dialog owns the keyboard. */
  trapActive?: boolean
  /** Views portal their primary actions into this element so the footer stays pinned while the body scrolls. */
  footerRef?: (el: HTMLElement | null) => void
  children: ReactNode
}

/**
 * One right-side drawer for every People view (full-height sheet on phones). Views swap inside it
 * instead of stacking drawers, so Back always returns to the previous view and focus never gets trapped
 * behind a hidden layer.
 */
export function PeopleDrawerShell({ eyebrow, title, viewKey, onClose, onBack, trapActive = true, footerRef, children }: ShellProps) {
  const { t } = usePeopleLabels()
  const panelRef = useRef<HTMLDivElement>(null!)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))

  const dialogOpen = useSyncExternalStore(subscribeDialogs, () => openDialogs > 0, () => false)
  useModalFocusTrap(panelRef, trapActive && !dialogOpen, onClose)

  // Announce and focus the new title whenever the view changes (and on open).
  useEffect(() => { if (trapActive) titleRef.current?.focus() }, [viewKey, trapActive])

  // Return focus to whatever opened the drawer, if it is still on the page.
  useEffect(() => () => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }, [opener])

  return createPortal(
    <div className="fixed inset-0 z-drawer" role="presentation" data-i18n-skip="true">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-xl outline-none sm:max-w-[480px] lg:max-w-[520px]"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          {onBack && (
            <IconButton variant="ghost" size="sm" onClick={onBack} aria-label={t('people.drawer.back')} className="-ml-1 h-11 w-11 sm:h-9 sm:w-9">
              <ArrowLeft size={18} aria-hidden="true" />
            </IconButton>
          )}
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{eyebrow}</p>}
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="truncate text-base font-semibold text-ink outline-none">{title}</h2>
          </div>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('people.drawer.close')} className="h-11 w-11 sm:h-9 sm:w-9">
            <X size={18} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">{children}</div>
        <footer
          ref={footerRef}
          className="shrink-0 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] empty:hidden sm:px-5"
        />
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmProps {
  title: string
  body: ReactNode
  confirmLabel: string
  tone?: 'destructive' | 'primary'
  busy?: boolean
  busyLabel?: string
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  cancelLabel?: string
}

/** Compact confirmation (not a drawer). Sits above the drawer and takes over the keyboard while open. */
export function PeopleConfirmDialog({
  title, body, confirmLabel, tone = 'primary', busy, busyLabel, error, onConfirm, onCancel, cancelLabel,
}: ConfirmProps) {
  const { t } = usePeopleLabels()
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const bodyId = useId()
  useModalFocusTrap(ref, true, busy ? undefined : onCancel)

  // Pause the drawer's trap while open, then put focus back on the control that opened this dialog.
  const [trigger] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  useEffect(() => {
    setDialogOpen(1)
    return () => {
      setDialogOpen(-1)
      setTimeout(() => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus() }, 0)
    }
  }, [trigger])

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation" data-i18n-skip="true">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-t-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl outline-none sm:rounded-[var(--r-lg)]"
      >
        <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm text-ink-2">{body}</div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{error}</p>
        )}
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy} className="flex-1 justify-center">{cancelLabel ?? t('common.cancel')}</Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
            className={cn('flex-1 justify-center')}
          >
            {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
