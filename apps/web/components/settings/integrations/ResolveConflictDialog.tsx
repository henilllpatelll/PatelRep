'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { errorMessage, errorStatus } from '@/lib/settings/apiErrors'
import type { OperaConflictResolution, OperaSyncConflict } from '@/lib/api/integrations'
import { RESOLUTION_OPTIONS, conflictFieldRows, conflictResourceLabel, formatTimestamp } from '@/lib/settings/integrations'
import { cn } from '@/lib/utils'
import type { OperaIntegration } from './useOperaIntegration'

/**
 * Human source-of-truth decision for one OPERA sync conflict.
 *
 * The backend resolves a conflict as a whole record, so there are exactly two choices and no per-field
 * picking. Nothing is pre-selected and nothing is chosen automatically. Only the four fields the decision
 * affects are shown — never the rest of the reservation snapshot. "Resolved" is only reported after the
 * server confirms; a 404 means the conflict was already handled, and the list is refreshed either way.
 */
export function ResolveConflictDialog({
  conflict, integration, onClose, onResolved,
}: {
  conflict: OperaSyncConflict
  integration: OperaIntegration
  onClose: () => void
  onResolved: (resolution: OperaConflictResolution) => void
}) {
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const bodyId = useId()
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null))
  const [pending, setPending] = useState<OperaConflictResolution | null>(null)
  const submitting = useRef(false) // synchronous guard: state updates land a tick after the click
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null)
  useModalFocusTrap(ref, true, pending ? undefined : onClose)

  useEffect(() => () => {
    setTimeout(() => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus() }, 0)
  }, [opener])

  const rows = conflictFieldRows(conflict)
  const detected = formatTimestamp(conflict.detected_at)

  const choose = async (resolution: OperaConflictResolution) => {
    if (submitting.current) return
    submitting.current = true
    setPending(resolution)
    setError(null)
    try {
      await integration.resolve.mutateAsync({ id: conflict.id, resolution })
      onResolved(resolution)
    } catch (err) {
      const stale = errorStatus(err) === 404
      setError({
        stale,
        message: stale
          ? 'This conflict was already resolved or no longer exists. The list has been refreshed.'
          : errorMessage(err, 'We couldn’t record that decision. Nothing was changed.'),
      })
      setPending(null)
      submitting.current = false
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={pending ? undefined : onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[var(--r-lg)] border border-line bg-surface shadow-xl outline-none sm:rounded-[var(--r-lg)]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <h2 id={titleId} className="text-base font-semibold text-ink">Resolve OPERA Sync Conflict</h2>
          <p id={bodyId} className="mt-1 text-sm text-ink-3">
            {conflictResourceLabel(conflict)}
            {detected ? ` · detected ${detected}` : ''}. Choose which system’s values this record should keep.
          </p>

          {rows.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-[var(--r-md)] border border-line">
              <table className="w-full min-w-[420px] text-left text-sm">
                <caption className="sr-only">Values that differ between PatelRep and OPERA for this record</caption>
                <thead className="bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  <tr>
                    <th scope="col" className="px-3 py-2">Field</th>
                    <th scope="col" className="px-3 py-2">PatelRep</th>
                    <th scope="col" className="px-3 py-2">OPERA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="px-3 py-2 font-medium text-ink-2">
                        {row.label}
                        {row.differs && <span className="ml-1.5 rounded bg-[var(--caution-soft)] px-1.5 py-px text-[10px] font-semibold uppercase text-[var(--caution)]">Differs</span>}
                      </th>
                      <td className={cn('px-3 py-2 text-ink', row.differs && 'font-medium')}>{row.local}</td>
                      <td className={cn('px-3 py-2 text-ink', row.differs && 'font-medium')}>{row.remote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-3">
              OPERA didn’t include comparable values for this record.
            </p>
          )}

          <p className="mt-3 text-xs text-ink-3">
            The decision applies to the whole record, not individual fields, and is recorded with your name in the conflict history.
          </p>

          <ul className="mt-4 space-y-3">
            {RESOLUTION_OPTIONS.map((option) => (
              <li key={option.value} className="rounded-[var(--r-md)] border border-line p-3">
                <p className="text-[13px] text-ink-2">{option.consequence}</p>
                <Button
                  className="mt-2.5 w-full justify-center sm:w-auto"
                  variant={option.value === 'remote_wins' ? 'primary' : 'outline'}
                  onClick={() => choose(option.value)}
                  loading={pending === option.value}
                  disabled={pending !== null && pending !== option.value}
                >
                  {option.label}
                </Button>
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{error.message}</p>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={onClose} disabled={pending !== null}>{error?.stale ? 'Close' : 'Cancel'}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
