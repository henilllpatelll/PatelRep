'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { Button } from '@/components/ui/Button'

/** Compact confirmation (alertdialog) for Settings. Traps focus, Escape cancels, focus returns to the opener. */
export function SettingsConfirmDialog({
  title, body, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', busy = false, error, onConfirm, onCancel,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'destructive'
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const bodyId = useId()
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  useModalFocusTrap(ref, true, busy ? undefined : onCancel)

  useEffect(() => () => {
    setTimeout(() => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus() }, 0)
  }, [opener])

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
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
          <Button variant="ghost" onClick={onCancel} disabled={busy} className="flex-1 justify-center">{cancelLabel}</Button>
          <Button variant={tone === 'destructive' ? 'destructive' : 'primary'} onClick={onConfirm} loading={busy} className="flex-1 justify-center">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
