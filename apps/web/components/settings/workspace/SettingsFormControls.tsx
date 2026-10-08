'use client'

import { forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const CONTROL =
  'w-full rounded-[var(--r-md)] border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60'

/** Label + control + hint/error wiring. Pass the same `id` to the control and use `controlA11y(id, …)`. */
export function SettingsField({ id, label, hint, error, required, className, children }: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-[var(--alert)]" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-ink-3">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-[var(--alert)]">{error}</p>}
    </div>
  )
}

export function controlA11y(id: string, opts: { error?: string; hint?: boolean; required?: boolean }) {
  return {
    id,
    'aria-invalid': opts.error ? (true as const) : undefined,
    'aria-required': opts.required ? (true as const) : undefined,
    'aria-describedby': opts.error ? `${id}-error` : opts.hint ? `${id}-hint` : undefined,
  }
}

export const SettingsSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      {...props}
      className={cn(CONTROL, 'min-h-[40px] cursor-pointer border-line', props['aria-invalid'] && 'border-[var(--alert)]', className)}
    />
  ),
)
SettingsSelect.displayName = 'SettingsSelect'

export const SettingsTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={3}
      {...props}
      className={cn(CONTROL, 'border-line', props['aria-invalid'] && 'border-[var(--alert)]', className)}
    />
  ),
)
SettingsTextarea.displayName = 'SettingsTextarea'

export const SettingsTextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(CONTROL, 'min-h-[40px] border-line', props['aria-invalid'] && 'border-[var(--alert)]', className)}
    />
  ),
)
SettingsTextInput.displayName = 'SettingsTextInput'
