'use client'

import { useState } from 'react'
import { format, parseISO, startOfWeek } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { housekeepingApi, InspectionRecord } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/shared/PageHeader'
import { Pill, StatusDot, SectionLabel } from '@/components/ui/primitives'

// -- Helpers ------------------------------------------------------------------

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function sevenDaysAgoISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return format(d, 'yyyy-MM-dd')
}

type InspectionResult = 'passed' | 'failed' | 'conditional'

function resultPillTone(result: InspectionResult): 'ready' | 'alert' | 'caution' {
  if (result === 'passed') return 'ready'
  if (result === 'failed') return 'alert'
  return 'caution'
}

function resultLabel(result: InspectionResult): string {
  if (result === 'passed') return 'Passed'
  if (result === 'failed') return 'Failed'
  return 'Conditional'
}

function InspectionQueueRow({ row, isFirst }: { row: InspectionRecord; isFirst: boolean }) {
  const isPending = !row.overall_result
  const isReopened = row.overall_result === 'failed'

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-t border-line-2 transition-colors ${
        isReopened ? 'bg-[var(--alert-soft)]' : isFirst && isPending ? 'bg-[var(--accent-soft)]' : ''
      }`}
    >
      {/* Room number badge */}
      <div className="w-11 h-11 rounded-[10px] bg-surface border border-line flex items-center justify-center shrink-0">
        <span className="font-mono text-[14px] font-semibold text-ink">{row.room_number}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-ink">{row.inspector_name || 'Unknown'}</div>
        <div className="text-[11.5px] text-ink3 mt-0.5">
          {format(parseISO(row.completed_at), 'h:mm a')}
          {row.notes ? ` · ${row.notes}` : ''}
        </div>
      </div>
      {isPending && (
        <Pill tone="caution" size="sm">to inspect</Pill>
      )}
      {!isPending && (
        <div className="flex items-center gap-2 shrink-0">
          <Pill tone={resultPillTone(row.overall_result as InspectionResult)} size="sm">
            {resultLabel(row.overall_result as InspectionResult)}
          </Pill>
        </div>
      )}
    </div>
  )
}

function InspectionMobileCard({ row }: { row: InspectionRecord }) {
  return (
    <div className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-base font-semibold text-ink">Room {row.room_number}</p>
          <p className="mt-0.5 text-sm text-ink3">
            {format(parseISO(row.completed_at), 'MMM d, yyyy h:mm a')}
          </p>
        </div>
        {row.overall_result && (
          <Pill tone={resultPillTone(row.overall_result as InspectionResult)} size="sm">
            {resultLabel(row.overall_result as InspectionResult)}
          </Pill>
        )}
      </div>
      {row.notes && (
        <p className="mt-2 text-sm text-ink2">{row.notes}</p>
      )}
      <p className="text-xs text-ink3 mt-1">Inspector: {row.inspector_name || 'Unknown'}</p>
    </div>
  )
}

// -- Page ---------------------------------------------------------------------

export default function InspectionsPage() {
  const [dateFrom, setDateFrom] = useState(sevenDaysAgoISO())
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
  const pendingCount = inspections.filter((i) => !i.overall_result).length

  // Split into queue (pending / recent) and history for the two-panel design
  const queueItems = inspections.slice(0, 6)
  const firstPending = queueItems.findIndex((i) => !i.overall_result)

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        eyebrow="Housekeeping"
        title="Inspections"
        subtitle="Pass, reopen, or flag rooms after housekeeping completes."
        actions={
          <Button variant="secondary" onClick={setToday}>
            Today
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-ink2">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="py-1.5 text-sm w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-ink2">To</label>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            className="py-1.5 text-sm w-auto"
          />
        </div>
        <Button variant="ghost" onClick={setThisWeek} className="px-3 py-1.5 text-sm">
          This Week
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="px-3 py-1.5 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface"
          >
            <option value="all">All Results</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="conditional">Conditional</option>
          </select>
        </div>
      </div>

      {/* Summary pills */}
      {!isLoading && count > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink3 font-mono">{count} inspections</span>
          {pendingCount > 0 && (
            <Pill tone="caution" size="sm">{pendingCount} pending</Pill>
          )}
        </div>
      )}

      {/* Two-panel layout on desktop, stack on mobile */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop two-panel */}
          <div className="hidden sm:grid grid-cols-2 gap-6">
            {/* Queue panel */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <SectionLabel hint={`${pendingCount} pending`}>Queue</SectionLabel>
              </div>
              {queueItems.length === 0 ? (
                <div className="px-4 py-16 text-center">
                  <p className="text-sm text-ink3">No inspections in this period.</p>
                </div>
              ) : (
                queueItems.map((row, i) => (
                  <InspectionQueueRow
                    key={row.id}
                    row={row}
                    isFirst={i === firstPending || (firstPending === -1 && i === 0)}
                  />
                ))
              )}
            </Card>

            {/* History table */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <SectionLabel hint={`${count} records`}>History</SectionLabel>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-2 text-xs text-ink3 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Room</th>
                    <th className="text-left px-4 py-2.5">Inspector</th>
                    <th className="text-left px-4 py-2.5">Result</th>
                    <th className="text-left px-4 py-2.5">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-sm text-ink3">
                        No inspections recorded yet
                      </td>
                    </tr>
                  ) : (
                    inspections.map((row) => (
                      <tr key={row.id} className="border-b border-line-2 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-ink">{row.room_number}</td>
                        <td className="px-4 py-3 text-ink2">{row.inspector_name || 'Unknown'}</td>
                        <td className="px-4 py-3">
                          {row.overall_result ? (
                            <Pill tone={resultPillTone(row.overall_result as InspectionResult)} size="sm">
                              {resultLabel(row.overall_result as InspectionResult)}
                            </Pill>
                          ) : (
                            <Pill tone="caution" size="sm">Pending</Pill>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink3 text-xs font-mono">
                          {format(parseISO(row.completed_at), 'MMM d, h:mm a')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Mobile card list */}
          <div className="sm:hidden">
            <Card className="p-0 overflow-hidden">
              {inspections.length === 0 ? (
                <div className="px-4 py-16 text-center">
                  <p className="text-sm text-ink3">No inspections recorded yet</p>
                  <p className="text-xs text-ink4 mt-1">Inspections submitted from the board will appear here.</p>
                </div>
              ) : (
                inspections.map((row) => <InspectionMobileCard key={row.id} row={row} />)
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
