'use client'

import { useState, useEffect, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoomEntry {
  room_id: string
  room_number: string
  status: string
}

interface HousekeeperRow {
  housekeeper_id: string
  name: string
  rooms_assigned: number
  rooms_done: number
  in_progress: number
  rooms: RoomEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DIRTY: 'bg-red-100 text-red-700',
    IN_PROGRESS: 'bg-purple-100 text-purple-700',
    CLEAN: 'bg-blue-100 text-blue-700',
    INSPECTED: 'bg-green-100 text-green-700',
    OOO: 'bg-orange-100 text-orange-700',
    PICKUP: 'bg-yellow-100 text-yellow-700',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AssignmentsPage() {
  const [date, setDate] = useState('')
  useEffect(() => {
    setDate(todayISO())
  }, [])
  const queryClient = useQueryClient()
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMessage, setAiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['housekeeping-assignments-page', date],
    queryFn: () => housekeepingApi.getAssignments(date),
  })

  const housekeepers: HousekeeperRow[] = (data as any)?.data ?? []

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAiAutoAssign = async () => {
    setAiLoading(true)
    setAiMessage(null)
    try {
      const result = await housekeepingApi.aiSuggestAssignments(date)
      const count = (result as any)?.data?.assignments_created ?? (result as any)?.data?.count ?? null
      setAiMessage({
        type: 'success',
        text: count !== null
          ? `AI suggested ${count} assignment${count !== 1 ? 's' : ''} — review the table below.`
          : 'AI suggestions applied — review the table below.',
      })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments-page', date] })
    } catch (err: any) {
      setAiMessage({
        type: 'error',
        text: err?.message || 'AI auto-assign failed. Please try again.',
      })
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Room Assignments</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage housekeeper assignments for a given date.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleAiAutoAssign}
          disabled={aiLoading}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {aiLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Thinking...
            </>
          ) : (
            'Auto-Assign with AI'
          )}
        </Button>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Date</label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="py-1.5 text-sm"
        />
        <Button
          variant="ghost"
          onClick={() => setDate(todayISO())}
          className="px-3 py-1.5 text-sm"
        >
          Today
        </Button>
        {date && (
          <span className="text-sm text-gray-400">
            {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
          </span>
        )}
      </div>

      {/* AI message banner */}
      {aiMessage && (
        <div className={`flex items-start gap-2.5 px-4 py-3 rounded-lg border text-sm ${
          aiMessage.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <span className="font-medium">{aiMessage.text}</span>
          <button onClick={() => setAiMessage(null)} className="ml-auto shrink-0 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="p-8 space-y-4 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Failed to load assignments. Please try again.
          </div>
        ) : housekeepers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">No assignments found for this date.</p>
            <p className="text-gray-300 text-xs mt-1">
              Use AI Auto-Assign or assign rooms from the Housekeeping Board.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/60 bg-amber-50/60 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Housekeeper</th>
                <th className="text-center px-4 py-3">Rooms Assigned</th>
                <th className="text-center px-4 py-3">Rooms Done</th>
                <th className="text-center px-4 py-3">In Progress</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {housekeepers.map((hk) => {
                const expanded = expandedRows.has(hk.housekeeper_id)
                return (
                  <Fragment key={hk.housekeeper_id}>
                    <tr
                      className="border-b border-white/40 hover:bg-amber-50/40 cursor-pointer transition-colors"
                      onClick={() => toggleRow(hk.housekeeper_id)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{hk.name}</td>
                      <td className="px-4 py-3 text-center text-gray-700">
                        {hk.rooms_assigned}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-green-600 font-medium">{hk.rooms_done}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-blue-600 font-medium">{hk.in_progress}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {expanded ? 'Hide' : 'Show'} rooms
                        <span className="ml-1">{expanded ? '▲' : '▼'}</span>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-amber-50/30">
                        <td colSpan={5} className="px-6 pb-3 pt-1">
                          <div className="flex flex-wrap gap-2">
                            {(hk.rooms ?? []).length === 0 ? (
                              <span className="text-xs text-gray-400">No rooms listed</span>
                            ) : (
                              [...(hk.rooms ?? [])].sort((a, b) =>
                              a.room_number.localeCompare(b.room_number, undefined, { numeric: true })
                            ).map((r) => (
                                <span
                                  key={r.room_id}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${statusBadge(r.status)}`}
                                >
                                  {r.room_number}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
