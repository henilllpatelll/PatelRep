'use client'

import { useId, useRef, type ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useReports } from './ReportsContext'

/**
 * Shared right-hand drawer shell for all five Reports drawers.
 * - role=dialog + aria-modal, labelled by its title; Escape closes; Tab is trapped; focus returns to the trigger.
 * - The report stays visible behind a light scrim; sticky header; content scrolls inside.
 * - Back (when we drilled in from another drawer) vs Close (always).
 */
export function ReportDrawer({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  const { closeDrawer, goBack, canGoBack } = useReports()
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  useModalFocusTrap(ref, true, closeDrawer)

  return (
    <>
      <div className="fixed inset-0 z-drawer bg-[rgba(26,24,21,0.28)] print:hidden" onClick={closeDrawer} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-report-drawer
        className="fixed right-0 top-0 z-drawer flex h-full w-full flex-col border-l border-line bg-paper shadow-pop outline-none sm:max-w-[560px] lg:max-w-[640px] print:hidden"
      >
        <header className="sticky top-0 z-10 flex items-start gap-2 border-b border-line bg-paper px-4 py-3">
          {canGoBack && (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back to previous detail"
              className="mt-0.5 rounded-md p-1.5 text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-display text-[19px] leading-tight text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[12.5px] text-ink3">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close details"
            className="rounded-md p-1.5 text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-paper px-4 py-3">{footer}</footer>}
      </div>
    </>
  )
}

export const drawerButton =
  'inline-flex items-center justify-center rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
export const drawerPrimaryButton =
  'inline-flex items-center justify-center rounded-[var(--r-md)] bg-accent px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
