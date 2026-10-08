'use client'

import { useEffect, useState } from 'react'
import {
  COMPARISON_LABELS,
  COMPARISON_MODES,
  DEPARTMENT_LABELS,
  PRESET_LABELS,
  RANGE_PRESETS,
  isValidCustomRange,
  resolvePreset,
  type ComparisonMode,
  type RangePreset,
} from '@/lib/reports/filters'
import { field } from './ReportModal'
import { useReports } from './ReportsContext'

const DEPARTMENT_AWARE = ['overview', 'guest-experience']

/** Global filters shared by every report: date range, comparison and (where applicable) department. */
export function ReportsFilterBar() {
  const { filters, setFilters, today, capabilities, view } = useReports()
  const [from, setFrom] = useState(filters.start)
  const [to, setTo] = useState(filters.end)
  const customInvalid = filters.preset === 'custom' ? false : false
  const draftValid = isValidCustomRange(from, to, today)
  const showDepartment = (capabilities?.departments.length ?? 0) > 1 && !!view && DEPARTMENT_AWARE.includes(view)

  useEffect(() => {
    setFrom(filters.start)
    setTo(filters.end)
  }, [filters.start, filters.end])

  const onPreset = (preset: RangePreset) => {
    if (preset === 'custom') setFilters({ preset: 'custom', start: from, end: to })
    else setFilters({ preset, ...resolvePreset(preset, today) })
  }

  return (
    <form
      role="search"
      aria-label="Report filters"
      className="flex flex-wrap items-end gap-3 rounded-[var(--r-lg)] border border-line bg-surface p-3 print:hidden"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="text-[12px] font-medium text-ink2">
        Date range
        <select className={`${field} mt-1 w-44`} value={filters.preset} onChange={(e) => onPreset(e.target.value as RangePreset)}>
          {RANGE_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
        </select>
      </label>

      {filters.preset === 'custom' && (
        <fieldset className="flex items-end gap-2">
          <legend className="sr-only">Custom date range</legend>
          <label className="text-[12px] font-medium text-ink2">
            From
            <input type="date" className={`${field} mt-1 w-36`} value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[12px] font-medium text-ink2">
            To
            <input type="date" className={`${field} mt-1 w-36`} value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={!draftValid || (from === filters.start && to === filters.end)}
            onClick={() => setFilters({ preset: 'custom', start: from, end: to })}
            className="h-9 rounded-[var(--r-md)] bg-accent px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
          >
            Apply
          </button>
          {!draftValid && <p role="alert" className="pb-2 text-[12px] text-[var(--alert)]">Pick a start on or before the end, not in the future, within 366 days.</p>}
        </fieldset>
      )}

      <label className="text-[12px] font-medium text-ink2">
        Compare with
        <select className={`${field} mt-1 w-56`} value={filters.compare} onChange={(e) => setFilters({ compare: e.target.value as ComparisonMode })}>
          {COMPARISON_MODES.map((m) => <option key={m} value={m}>{COMPARISON_LABELS[m]}</option>)}
        </select>
      </label>

      {showDepartment && (
        <label className="text-[12px] font-medium text-ink2">
          Department
          <select className={`${field} mt-1 w-40`} value={filters.department} onChange={(e) => setFilters({ department: e.target.value as typeof filters.department })}>
            <option value="">All departments</option>
            {capabilities!.departments.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d] ?? d}</option>)}
          </select>
        </label>
      )}
      <p className="ml-auto pb-1.5 text-[12px] text-ink3" aria-live="polite">
        {filters.start === filters.end ? filters.start : `${filters.start} – ${filters.end}`} · hotel time{customInvalid ? '' : ''}
      </p>
    </form>
  )
}
