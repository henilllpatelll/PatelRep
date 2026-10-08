'use client'

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { AlertTriangle, Check, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { usePeopleLabels } from './usePeopleLabels'

const control =
  'w-full min-h-[44px] rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-4 transition-colors sm:min-h-[40px] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3'

interface FieldProps {
  label: string
  error?: string | null
  hint?: string
  required?: boolean
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** Label + control + hint + announced error, wired together with ids. */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const { t } = usePeopleLabels()
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-1 text-[var(--alert)]" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> {t('people.form.required')}</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && <p id={hintId} className="mt-1 text-xs text-ink-3">{hint}</p>}
      {error && <p id={errId} role="alert" className="mt-1 text-xs font-medium text-[var(--alert)]">{error}</p>}
    </div>
  )
}

type TextProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & { id: string; invalid?: boolean; describedBy?: string }

export function TextControl({ invalid, describedBy, ...rest }: TextProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(control, invalid ? 'border-[var(--alert)]' : 'border-line hover:border-line-2')}
    />
  )
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & { id: string; invalid?: boolean; describedBy?: string }

export function SelectControl({ invalid, describedBy, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(control, 'pr-8', invalid ? 'border-[var(--alert)]' : 'border-line hover:border-line-2')}
    >
      {children}
    </select>
  )
}

/** Read-only detail row used by profile + invitation details. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-2 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-ink">{children}</dd>
    </div>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-6 first:mt-0">
      <div className="mb-1 flex min-h-[28px] items-center justify-between gap-3">
        <h3 id={id} className="text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Inline banner. `alert` is announced immediately; `status` politely. */
export function Banner({ tone, children, action }: { tone: 'error' | 'warning' | 'success' | 'info'; children: ReactNode; action?: ReactNode }) {
  const styles = {
    error: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]',
    warning: 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]',
    success: 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]',
    info: 'border-line bg-surface-2 text-ink-2',
  }[tone]
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]', styles)}>
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** Primary/secondary footer. The primary button shows progress and blocks double submits. */
export function FormFooter({
  primaryLabel, busyLabel, busy, disabled, onPrimary, onCancel, cancelLabel, formId, tone = 'primary',
}: {
  primaryLabel: string; busyLabel: string; busy?: boolean; disabled?: boolean
  onPrimary?: () => void; onCancel: () => void; cancelLabel?: string; formId?: string; tone?: 'primary' | 'destructive'
}) {
  const { t } = usePeopleLabels()
  return (
    <div className="flex gap-3">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="flex-1 justify-center">
        {cancelLabel ?? t('common.cancel')}
      </Button>
      <Button
        type={formId ? 'submit' : 'button'}
        form={formId}
        variant={tone}
        onClick={onPrimary}
        disabled={busy || disabled}
        aria-busy={busy}
        className="flex-1 justify-center"
      >
        {busy ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {busy ? busyLabel : primaryLabel}
      </Button>
    </div>
  )
}

export function Chip({ selected, onClick, children, label, disabled }: {
  selected: boolean; onClick: () => void; children: ReactNode; label?: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors sm:min-h-[36px] sm:min-w-[36px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50',
        selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
      )}
    >
      {selected && <Check size={12} aria-hidden="true" />}
      {children}
    </button>
  )
}
