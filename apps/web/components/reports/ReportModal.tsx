'use client'

import { useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { cn } from '@/lib/utils'

/** Accessible centered modal (focus trap, Escape, labelled) used by Export, Schedule and Scheduled Reports. */
export function ReportModal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const descId = useId()
  useModalFocusTrap(ref, true, onClose)

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center sm:items-center print:hidden" role="presentation">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-[var(--r-xl)] border border-line bg-paper shadow-pop outline-none sm:rounded-[var(--r-xl)]', wide ? 'sm:max-w-[820px]' : 'sm:max-w-[560px]')}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="font-display text-[20px] leading-tight text-ink">{title}</h2>
            {description && <p id={descId} className="mt-1 text-[13px] text-ink3">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export const field =
  'h-9 w-full rounded-[var(--r-md)] border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
export const secondaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:opacity-50'
export const primaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-[var(--r-md)] bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:opacity-50'

export function FieldLabel({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-[12.5px] font-medium text-ink2">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[12px] font-normal text-ink3">{hint}</span>}
    </label>
  )
}
