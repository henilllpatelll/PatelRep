'use client'

import { Lock } from 'lucide-react'
import type { ModuleDef } from '@/lib/settings/rolesAccess'
import { toggleModule } from '@/lib/settings/rolesAccess'
import { cn } from '@/lib/utils'

/** Module checkboxes. Dashboard is always on and shown first as a locked row so nobody wonders where it went. */
export function ModuleChecklist({ legend, modules, selected, onChange, disabled = false, error, idPrefix }: {
  legend: string
  modules: readonly ModuleDef[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  error?: string
  idPrefix: string
}) {
  return (
    <fieldset disabled={disabled} className="space-y-2" aria-describedby={error ? `${idPrefix}-error` : undefined}>
      <legend className="mb-1 text-sm font-semibold text-ink">{legend}</legend>
      <ul className="divide-y divide-line rounded-[var(--r-md)] border border-line">
        <li className="flex items-center gap-3 bg-surface-2 px-3 py-2.5">
          <Lock size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Dashboard</p>
            <p className="text-xs text-ink-3">Always available to everyone.</p>
          </div>
          <span className="text-xs font-medium text-ink-3">Always on</span>
        </li>
        {modules.map((module) => {
          const id = `${idPrefix}-${module.key}`
          const checked = selected.includes(module.key)
          return (
            <li key={module.key}>
              <label htmlFor={id} className={cn('flex min-h-[48px] cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2', disabled && 'cursor-not-allowed opacity-60')}>
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(toggleModule(selected, module.key))}
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{module.label}</span>
                  <span className="block text-xs text-ink-3">{module.description}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && <p id={`${idPrefix}-error`} role="alert" className="text-xs text-[var(--alert)]">{error}</p>}
    </fieldset>
  )
}
