'use client'

import { useState, useEffect, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { OccupancyImportModal } from '@/components/housekeeping/OccupancyImportModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/shared/PageHeader'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'

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
    OCCUPIED: 'bg-red-100 text-red-700',
    IN_PROGRESS: 'bg-purple-100 text-purple-700',
    CLEAN: 'bg-blue-100 text-blue-700',
    INSPECTED: 'bg-green-100 text-green-700',
    OOO: 'bg-[var(--blocked-soft)] text-[var(--blocked)] border border-[var(--blocked-line)]',
    PICKUP: 'bg-yellow-100 text-yellow-700',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AssignmentsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [date, setDate] = useState('')
  useEffect(() => {
    setDate(todayISO())
  }, [])
  const queryClient = useQueryClient()
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

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
    try {
      const result = await housekeepingApi.aiSuggestAssignments(date)
      const count = (result as any)?.data?.assignments_created ?? (result as any)?.data?.count ?? null
      toast.success(
        count !== null
          ? (count === 1
            ? t('housekeeping.assignmentsPage.aiSuccessOne', { count })
            : t('housekeeping.assignmentsPage.aiSuccessOther', { count }))
          : t('housekeeping.assignmentsPage.aiSuccessGeneric'),
      )
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments-page', date] })
    } catch (err: any) {
      toast.error(err?.message || t('housekeeping.assignmentsPage.aiFailure'))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {showImport && (
        <OccupancyImportModal
          date={date}
          onClose={() => setShowImport(false)}
        />
      )}

      <PageHeader
        eyebrow="Housekeeping"
        title={t('housekeeping.assignmentsPage.heading')}
        subtitle={t('housekeeping.assignmentsPage.subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setShowImport(true)}
              className="border border-stone-200 text-stone-700 hover:bg-stone-50 gap-1.5"
            >
              {t('housekeeping.assignmentsPage.importFromOpera')}
            </Button>
            <Button
              variant="primary"
              onClick={handleAiAutoAssign}
              disabled={aiLoading}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {aiLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {t('housekeeping.assignmentsPage.thinking')}
                </>
              ) : (
                t('housekeeping.assignmentsPage.autoAssignWithAi')
              )}
            </Button>
          </>
        }
      />

      {/* Date picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">{t('housekeeping.assignmentsPage.dateLabel')}</label>
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
          {t('housekeeping.assignmentsPage.today')}
        </Button>
        {date && (
          <span className="text-sm text-gray-400">
            {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
          </span>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <StateBlock
          status={isLoading ? 'loading' : isError ? 'error' : housekeepers.length === 0 ? 'empty' : null}
          empty={{
            title: t('housekeeping.assignmentsPage.emptyTitle'),
            body: t('housekeeping.assignmentsPage.emptySubtitle'),
          }}
          error={{ message: t('housekeeping.assignmentsPage.loadError') }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/60 bg-amber-50/60 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('housekeeping.assignmentsPage.table.housekeeper')}</th>
                <th className="text-center px-4 py-3">{t('housekeeping.assignmentsPage.table.roomsAssigned')}</th>
                <th className="text-center px-4 py-3">{t('housekeeping.assignmentsPage.table.roomsDone')}</th>
                <th className="text-center px-4 py-3">{t('housekeeping.assignmentsPage.table.inProgress')}</th>
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
                        {expanded ? t('housekeeping.assignmentsPage.table.hideRooms') : t('housekeeping.assignmentsPage.table.showRooms')}
                        <span className="ml-1">{expanded ? '▲' : '▼'}</span>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-amber-50/30">
                        <td colSpan={5} className="px-6 pb-3 pt-1">
                          <div className="flex flex-wrap gap-2">
                            {(hk.rooms ?? []).length === 0 ? (
                              <span className="text-xs text-gray-400">{t('housekeeping.assignmentsPage.table.noRoomsListed')}</span>
                            ) : (
                              [...(hk.rooms ?? [])].sort((a, b) =>
                              a.room_number.localeCompare(b.room_number, undefined, { numeric: true })
                            ).map((r) => (
                                <span
                                  key={r.room_id}
                                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusBadge(r.status)}`}
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
        </StateBlock>
      </Card>
    </div>
  )
}
