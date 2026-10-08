'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  sortable?: boolean
  /** Value used for sorting (null sorts last in both directions so "unknown" is never best/worst). */
  sortValue?: (row: T) => string | number | null
  render?: (row: T) => ReactNode
  className?: string
}

/** Sortable, optionally searchable/paginated table with proper table semantics. */
export function ReportDataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  searchText,
  searchPlaceholder = 'Search',
  pageSize,
  onRowClick,
  rowLabel,
  emptyText = 'No records to show.',
  initialSort,
  toolbar,
}: {
  caption: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Provide to enable a search box; returns the searchable text of a row. */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  pageSize?: number
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  emptyText?: string
  initialSort?: { key: string; desc?: boolean }
  toolbar?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(1)

  const processed = useMemo(() => {
    let list = rows
    if (searchText && query.trim()) {
      const needle = query.trim().toLowerCase()
      list = list.filter((row) => searchText(row).toLowerCase().includes(needle))
    }
    const column = columns.find((c) => c.key === sort?.key)
    if (column?.sortValue) {
      const read = column.sortValue
      const present = list.filter((r) => read(r) !== null)
      const missing = list.filter((r) => read(r) === null)
      present.sort((a, b) => {
        const x = read(a) as string | number
        const y = read(b) as string | number
        const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y)
        return sort?.desc ? -cmp : cmp
      })
      list = [...present, ...missing]
    }
    return list
  }, [rows, query, sort, columns, searchText])

  const pages = pageSize ? Math.max(1, Math.ceil(processed.length / pageSize)) : 1
  const current = Math.min(page, pages)
  const visible = pageSize ? processed.slice((current - 1) * pageSize, current * pageSize) : processed

  return (
    <div className="space-y-2">
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {searchText && (
            <label className="relative">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink3" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder={searchPlaceholder}
                className="h-9 w-56 rounded-[var(--r-md)] border border-line bg-surface pl-8 pr-2 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
              />
            </label>
          )}
          {toolbar}
        </div>
      )}
      <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-ink3">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort?.desc ? 'descending' : 'ascending') : c.sortable ? 'none' : undefined}
                    className={cn('whitespace-nowrap px-3 py-2 font-semibold', c.align === 'right' && 'text-right', c.className)}
                  >
                    {c.sortable && c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => setSort(active && !sort?.desc ? { key: c.key, desc: true } : { key: c.key })}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                      >
                        {c.label}
                        {active && (sort?.desc ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-ink3">
                  {query ? 'No rows match your search.' : emptyText}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn('border-t border-line', onRowClick && 'cursor-pointer hover:bg-surface-2 focus-within:bg-surface-2')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn('px-3 py-2 align-top text-ink2', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                      {onRowClick && i === 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRowClick(row)
                          }}
                          aria-label={rowLabel ? rowLabel(row) : undefined}
                          className="text-left font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                        >
                          {c.render ? c.render(row) : String((row as any)[c.key] ?? '—')}
                        </button>
                      ) : c.render ? (
                        c.render(row)
                      ) : (
                        String((row as any)[c.key] ?? '—')
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pageSize && processed.length > pageSize && (
        <div className="flex items-center justify-between text-[12.5px] text-ink3 print:hidden">
          <span>
            {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, processed.length)} of {processed.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded-md border border-line p-1.5 hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded-md border border-line p-1.5 hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
