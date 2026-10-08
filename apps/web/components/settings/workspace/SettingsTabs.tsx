'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsTabItem<T extends string = string> { id: T; label: string }

/**
 * Accessible tab strip (WAI-ARIA tabs pattern): roving tabindex, Arrow/Home/End keys, and ids that pair with
 * `SettingsTabPanel`. Selection is controlled so callers can guard it (e.g. unsaved-changes confirmation).
 */
export function SettingsTabs<T extends string>({ tabs, value, onChange, label, idPrefix, className }: {
  tabs: readonly SettingsTabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  idPrefix: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    const target = tabs[next]
    onChange(target.id)
    requestAnimationFrame(() => refs.current[target.id]?.focus())
  }

  return (
    <div role="tablist" aria-label={label} className={cn('flex overflow-x-auto border-b border-line', className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(node) => { refs.current[tab.id] = node }}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px min-h-[44px] shrink-0 border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[40px]',
              selected ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsTabPanel({ idPrefix, tab, children }: { idPrefix: string; tab: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${tab}`} aria-labelledby={`${idPrefix}-tab-${tab}`} tabIndex={-1} className="outline-none">
      {children}
    </div>
  )
}
