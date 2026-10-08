'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/Button'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'

/**
 * Standard right-side drawer for Settings editing (full-height sheet on phones).
 *
 * - dialog semantics, focus trap, Escape/backdrop/close-button all route through `requestClose`
 * - `dirty` turns every dismissal into a "Discard changes?" confirmation, and warns on page unload
 * - header and footer stay pinned while the body scrolls; focus returns to the opener on close
 *
 * Domain drawers (Phase 2+) render their form as `children` and their actions in `footer`.
 */
export function SettingsDrawer({
  title, description, onClose, dirty = false, footer, children, width = 'md',
}: {
  title: string
  description?: string
  onClose: () => void
  /** True while the drawer holds unsaved edits. */
  dirty?: boolean
  footer?: ReactNode
  children: ReactNode
  width?: 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const descId = useId()
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  const [confirming, setConfirming] = useState(false)

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])

  // The drawer's own trap stands down while the discard confirmation owns the keyboard.
  useModalFocusTrap(panelRef, !confirming, requestClose)

  useEffect(() => () => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }, [opener])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return createPortal(
    <div className="fixed inset-0 z-drawer" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-xl outline-none',
          width === 'lg' ? 'sm:max-w-[560px] lg:max-w-[640px]' : 'sm:max-w-[480px] lg:max-w-[520px]',
        )}
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-semibold text-ink">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <IconButton variant="ghost" size="sm" onClick={requestClose} aria-label="Close" className="h-11 w-11 sm:h-9 sm:w-9">
            <X size={18} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">{footer}</footer>
        )}
      </div>
      {confirming && (
        <SettingsConfirmDialog
          title="Discard unsaved changes?"
          body={<p>Your edits to “{title}” haven’t been saved. If you close now they will be lost.</p>}
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="destructive"
          onCancel={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); onClose() }}
        />
      )}
    </div>,
    document.body,
  )
}
