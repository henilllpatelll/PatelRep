'use client'

import { Search, X } from 'lucide-react'
import { SettingsSelect } from '@/components/settings/workspace/SettingsFormControls'
import { cn } from '@/lib/utils'
import { ALL } from '@/lib/settings/rooms'

export function SearchBox({ value, onChange, label, placeholder, className }: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)} role="search">
      <label className="sr-only" htmlFor={`search-${label}`}>{label}</label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        id={`search-${label}`}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="min-h-[40px] w-full rounded-[var(--r-md)] border border-line bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function FilterSelect({ label, value, onChange, options, allLabel }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  allLabel: string
}) {
  return (
    <div>
      <label className="sr-only" htmlFor={`filter-${label}`}>{label}</label>
      <SettingsSelect id={`filter-${label}`} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-[8.5rem]">
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </SettingsSelect>
    </div>
  )
}
