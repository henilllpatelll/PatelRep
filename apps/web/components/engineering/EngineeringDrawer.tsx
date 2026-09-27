'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface EngineeringDrawerProps {
  open: boolean
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  label?: string
  closeLabel: string
  width?: 'normal' | 'wide'
  closeDisabled?: boolean
}

/** Shared solid slide-over shell for Engineering create and action flows. */
export function EngineeringDrawer({
  open, title, children, footer, onClose, label, closeLabel, width = 'normal', closeDisabled = false,
}: EngineeringDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeDisabled, onClose, open])
  useModalFocusTrap(panelRef, open, () => { if (!closeDisabled) onClose() })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-drawer" role="presentation">
      <button
        type="button"
        className="absolute inset-0 w-full cursor-default bg-[rgba(26,24,21,0.28)]"
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        className={`absolute right-0 top-0 flex h-[100dvh] w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)] outline-none sm:w-[min(${width === 'wide' ? '640px' : '580px'},92vw)]`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <h2 className="font-display text-[25px] leading-tight text-ink">{title}</h2>
          <IconButton onClick={onClose} disabled={closeDisabled} aria-label={closeLabel}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="shrink-0 border-t border-line bg-surface px-5 py-3 sm:px-6">{footer}</footer>}
      </section>
    </div>
  )
}
