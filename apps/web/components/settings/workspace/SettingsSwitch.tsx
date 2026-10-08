'use client'

import { cn } from '@/lib/utils'

/** On/off switch with a visible label and optional description. Associates both with the control for screen readers. */
export function SettingsSwitch({ id, checked, onChange, label, description, disabled = false, className }: {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-line bg-surface-2',
        )}
      >
        <span aria-hidden="true" className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[20px]' : 'translate-x-[3px]')} />
      </button>
      <div className="min-w-0">
        <label id={`${id}-label`} htmlFor={id} className={cn('block text-sm font-medium text-ink', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>{label}</label>
        {description && <p id={`${id}-desc`} className="mt-0.5 text-xs leading-5 text-ink-3">{description}</p>}
      </div>
    </div>
  )
}
