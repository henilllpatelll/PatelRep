'use client'

import { useState } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ROLE_VALUES, STATUS_ORDER, UNASSIGNED_DEPARTMENT, hasActiveFilters,
  type DirectoryFilters,
} from '@/lib/people/peopleDirectory'
import { usePeopleLabels } from './usePeopleLabels'

interface Props {
  /** Search text is controlled separately so typing stays instant while the URL update is debounced. */
  search: string
  onSearch: (value: string) => void
  filters: DirectoryFilters
  onChange: (patch: Partial<DirectoryFilters>) => void
  onClear: () => void
  departments: { id: string; name: string }[]
  showUnassigned: boolean
}

function Select({
  label, value, onChange, children,
}: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="relative block min-w-0 flex-1 md:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-8 text-sm text-ink transition-colors hover:border-[var(--caution-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] md:h-9 md:w-auto"
      >
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
    </label>
  )
}

export function PeopleFilters({ search, onSearch, filters, onChange, onClear, departments, showUnassigned }: Props) {
  const { t, roleLabel, statusLabel } = usePeopleLabels()
  const [open, setOpen] = useState(false)
  const active = hasActiveFilters(filters) || !!search.trim()
  const narrowed = [filters.department, filters.role, filters.status !== 'active' ? filters.status : ''].filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label={t('people.search.label')}
          placeholder={t('people.search.placeholder')}
          className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-10 text-[14px] text-ink placeholder:text-ink-3 transition-colors hover:border-[var(--caution-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label={t('people.search.clear')}
            className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="people-filter-panel"
        className="flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink-2 md:hidden"
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        {t('people.filters.toggle')}
        {narrowed > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{narrowed}</span>}
      </button>

      <div id="people-filter-panel" className={cn('flex-wrap items-center gap-2', open ? 'flex' : 'hidden', 'md:flex')}>
        <Select label={t('people.filters.department')} value={filters.department} onChange={(v) => onChange({ department: v })}>
          <option value="">{t('people.filters.allDepartments')}</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          {showUnassigned && <option value={UNASSIGNED_DEPARTMENT}>{t('people.filters.unassigned')}</option>}
        </Select>
        <Select label={t('people.filters.role')} value={filters.role} onChange={(v) => onChange({ role: v as DirectoryFilters['role'] })}>
          <option value="">{t('people.filters.allRoles')}</option>
          {ROLE_VALUES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </Select>
        <Select label={t('people.filters.status')} value={filters.status} onChange={(v) => onChange({ status: v as DirectoryFilters['status'] })}>
          <option value="all">{t('people.filters.allStatuses')}</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        {active && (
          <button
            type="button"
            onClick={onClear}
            className="h-11 rounded-lg px-3 text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] md:h-9"
          >
            {t('people.filters.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
