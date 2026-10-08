'use client'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Save / Discard bar. Both actions stay disabled until the form is dirty, so the user always knows
 * whether anything is unsaved. `sticky` pins it to the bottom of the scrolling content.
 */
export function SettingsActionFooter({
  dirty, saving = false, onSave, onDiscard, saveLabel = 'Save changes', discardLabel = 'Discard', dirtyMessage = 'You have unsaved changes.', error, sticky = false, className,
}: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  saveLabel?: string
  discardLabel?: string
  /** Shown while dirty and not erroring; say what is pending when the edit is not obvious. */
  dirtyMessage?: string
  error?: string | null
  sticky?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-4 py-3',
        sticky && 'sticky bottom-0 z-10 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <p role={error ? 'alert' : 'status'} className={cn('mr-auto text-[13px]', error ? 'text-[var(--alert)]' : 'text-ink-3')}>
        {error ?? (dirty ? dirtyMessage : '')}
      </p>
      <Button variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>{discardLabel}</Button>
      <Button onClick={onSave} disabled={!dirty} loading={saving}>{saveLabel}</Button>
    </div>
  )
}
