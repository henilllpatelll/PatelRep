'use client'

import { useState } from 'react'
import { format, parseISO, startOfWeek } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { housekeepingApi, InspectionRecord } from '@/lib/api/housekeeping'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

type InspectionResult = 'passed' | 'failed' | 'conditional'

function resultBadge(result: InspectionResult) {
  const map: Record<InspectionResult, { bg: string; label: string }> = {
    passed: { bg: 'bg-green-100 text-green-700', label: 'Passed' },
    failed: { bg: 'bg-red-100 text-red-700', label: 'Failed' },
    conditional: { bg: 'bg-yellow-100 text-yellow-700', label: 'Conditional' },
  }
  const cfg = map[result] ?? { bg: 'bg-gray-100 text-gray-600', label: result }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.bg}`}>
      {cfg.label}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InspectionsPage() {
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [resultFilter, setResultFilter] = useState<string>('all')

  const { data: inspections = [], isLoading } = useQuery<InspectionRecord[]>({
    queryKey: ['housekeeping-inspections', dateFrom, dateTo, resultFilter],
    queryFn: () =>
      housekeepingApi
        .getInspections({
          date_from: dateFrom,
          date_to: dateTo,
          result: resultFilter === 'all' ? undefined : resultFilter,
        })
        .then((res) => res.data),
  })

  function setToday() {
    const today = todayISO()
    setDateFrom(today)
    setDateTo(today)
  }

  function setThisWeek() {
    const thisMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    setDateFrom(thisMonday)
    setDateTo(todayISO())
  }

  const count = inspections.length

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inspection History</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isLoading
            ? 'Loading inspections…'
            : count === 0
            ? 'No inspections recorded for the selected period.'
            : `${count} inspection${count !== 1 ? 's' : ''} in selected period`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date range */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Shortcut buttons */}
        <button
          onClick={setToday}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Today
        </button>
        <button
          onClick={setThisWeek}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          This Week
        </button>

        {/* Result filter */}
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm font-medium text-gray-700">Filter</label>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          >
            <option value="all">All Results</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="conditional">Conditional</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-4 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Room</th>
                <th className="text-left px-4 py-3">Inspector</th>
                <th className="text-left px-4 py-3">Result</th>
                <th className="text-left px-4 py-3">Date / Time</th>
                <th className="text-left px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {inspections.length > 0 ? (
                inspections.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      Room {row.room_number}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.inspector_name}</td>
                    <td className="px-4 py-3">{resultBadge(row.overall_result)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {format(parseISO(row.completed_at), 'MMM d, yyyy h:mm a')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                      {row.notes ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <p className="text-gray-400 text-sm font-medium">
                      No inspections recorded yet
                    </p>
                    <p className="text-gray-300 text-xs mt-1">
                      Inspections submitted from the board will appear here.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
