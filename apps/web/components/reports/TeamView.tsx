'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { formatValue, titleCase } from '@/lib/reports/format'
import type { StaffRow, TeamData } from '@/lib/reports/types'
import { AvailabilityNotice, EmptyBlock, LowSampleBadge, ReportSection } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { useViewData } from './useReportData'

const PAGE_SIZE = 25

const COLUMNS: Array<{ key: string; label: string; sort?: string; align?: 'right' }> = [
  { key: 'name', label: 'Employee', sort: 'name' },
  { key: 'role', label: 'Department / role', sort: 'role' },
  { key: 'tasks', label: 'Tasks completed / assigned', sort: 'tasks_completed', align: 'right' },
  { key: 'wo', label: 'Work orders completed / assigned', sort: 'wo_completed', align: 'right' },
  { key: 'sla', label: 'Eligible SLA', sort: 'sla_compliance_pct', align: 'right' },
  { key: 'labor', label: 'Recorded labor hours', sort: 'total_labor_hours', align: 'right' },
]

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function TeamView() {
  const { openDrawer, filters, setFilters, capabilities } = useReports()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [sort, setSort] = useState('name')
  const [desc, setDesc] = useState(false)
  const debouncedSearch = useDebounced(search)

  // Any filter change returns to page 1 (server-side pagination).
  useEffect(() => setPage(1), [debouncedSearch, role, sort, desc, filters.start, filters.end, filters.department])

  const query = useViewData<TeamData>('team', { page, per_page: PAGE_SIZE, search: debouncedSearch || undefined, role: role || undefined, sort, desc })
  const departments = capabilities?.departments ?? []

  const toggleSort = (key?: string) => {
    if (!key) return
    if (sort === key) setDesc(!desc)
    else {
      setSort(key)
      setDesc(false)
    }
  }

  return (
    <QueryBoundary query={query} label="team">
      {(data) => {
        const totalPages = Math.max(1, Math.ceil(data.meta.total / data.meta.per_page))
        return (
          <>
            <ViewHeader title="Team Performance" subtitle="Workload, assignment completion and service execution for the teams you manage." />
            <KpiGrid kpis={data.kpis} />

            <ReportSection
              title="Staff"
              description="Sorted alphabetically by default. This is workload context, not a ranking: roles and assignments differ."
              actions={
                departments.length > 1 ? (
                  <label className="flex items-center gap-2 text-[12.5px] text-ink2">
                    Department
                    <select
                      value={filters.department}
                      onChange={(e) => setFilters({ department: e.target.value as typeof filters.department })}
                      className="h-8 rounded-[var(--r-md)] border border-line bg-surface px-2 text-[12.5px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    >
                      <option value="">All departments</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{titleCase(d)}</option>
                      ))}
                    </select>
                  </label>
                ) : undefined
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
                <label className="relative">
                  <span className="sr-only">Search by employee name</span>
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink3" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search employees"
                    className="h-9 w-56 rounded-[var(--r-md)] border border-line bg-surface pl-8 pr-2 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                  />
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-ink2">
                  Role
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-[var(--r-md)] border border-line bg-surface px-2 text-[13px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                    <option value="">All roles</option>
                    {data.roles.map((r) => (
                      <option key={r} value={r}>{titleCase(r)}</option>
                    ))}
                  </select>
                </label>
              </div>

              {data.staff.length === 0 ? (
                <EmptyBlock title={search || role ? 'No employees match your filters' : 'No staff activity in this period'} body="Staff appear here once tasks or work orders are assigned to them in the selected dates." />
              ) : (
                <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
                  <table className="w-full min-w-[760px] border-collapse text-[13px]">
                    <caption className="sr-only">Staff workload and eligible SLA compliance</caption>
                    <thead className="bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-ink3">
                      <tr>
                        {COLUMNS.map((c) => (
                          <th key={c.key} scope="col" aria-sort={sort === c.sort ? (desc ? 'descending' : 'ascending') : 'none'} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                            <button type="button" onClick={() => toggleSort(c.sort)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                              {c.label}
                              {sort === c.sort && (desc ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.staff.map((s: StaffRow) => (
                        <tr key={s.user_id} className="border-t border-line hover:bg-surface-2">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => openDrawer({ kind: 'employee-performance', userId: s.user_id })}
                              aria-label={`${s.name}: open performance detail`}
                              className="text-left font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                            >
                              {s.name}
                            </button>
                            {s.low_sample && <span className="ml-2"><LowSampleBadge n={s.tasks_total + s.wo_total} /></span>}
                          </td>
                          <td className="px-3 py-2 text-ink2">{titleCase(s.department ?? '')} · {titleCase(s.role)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.tasks_completed} / {s.tasks_total}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.wo_completed} / {s.wo_total}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.sla_compliance_pct === null ? <span className="text-ink3">Not applicable</span> : <>{formatValue(s.sla_compliance_pct, 'percent')} <span className="text-ink3">({s.sla_met}/{s.sla_eligible})</span></>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.total_labor_hours === null ? <span className="text-ink3">Not tracked</span> : formatValue(s.total_labor_hours, 'hours')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.meta.total > data.meta.per_page && (
                <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink3 print:hidden">
                  <span>Page {data.meta.page} of {totalPages} · {data.meta.total} employees</span>
                  <div className="flex gap-1">
                    <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-line p-1.5 hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md border border-line p-1.5 hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                </div>
              )}
              {data.notes.map((note) => (
                <AvailabilityNotice key={note} className="mt-3" availability="not_applicable" label={null} reason={note} />
              ))}
            </ReportSection>
          </>
        )
      }}
    </QueryBoundary>
  )
}
