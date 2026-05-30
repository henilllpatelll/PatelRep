'use client'

import { useEffect, useState } from 'react'
import { format, parseISO, startOfWeek } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { housekeepingApi, InspectionRecord, ReadyForInspectionRoom } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/shared/PageHeader'
import { Pill } from '@/components/ui/primitives'
import { InspectionModal } from '@/components/housekeeping/InspectionModal'
import { getCleanTypeLabel } from '@/lib/utils/cleanType'

type OverallResult = 'passed' | 'failed' | 'conditional'
type InspectionResult = 'passed' | 'failed' | 'conditional'

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function sevenDaysAgoISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return format(d, 'yyyy-MM-dd')
}

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

function QueueCard({ room, onInspect }: { room: ReadyForInspectionRoom; onInspect: () => void }) {
  const cleanLabel = getCleanTypeLabel(room.clean_type)
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-line last:border-b-0">
      <div className="w-12 h-12 rounded-[10px] bg-surface border border-line flex items-center justify-center shrink-0">
        <span className="font-mono text-[14px] font-semibold text-ink">{room.room_number}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-ink">{room.cleaned_by || 'Unassigned'}</span>
          {cleanLabel && <span className="text-xs text-ink3 font-mono">{cleanLabel}</span>}
          {room.floor != null && <span className="text-xs text-ink4">Floor {room.floor}</span>}
        </div>
        {room.cleaned_at && (
          <p className="text-xs text-ink3 mt-0.5">
            Cleaned at {format(new Date(room.cleaned_at), 'h:mm a')}
          </p>
        )}
      </div>
      <Button variant="secondary" onClick={onInspect} className="shrink-0 text-sm px-3 py-1.5">
        <ClipboardCheck className="w-4 h-4 mr-1.5" />
        Inspect
      </Button>
    </div>
  )
}

export default function InspectionsPage() {
  const [tab, setTab] = useState<'live' | 'history'>('live')

  const [inspectingRoom, setInspectingRoom] = useState<ReadyForInspectionRoom | null>(null)

  const [reassignCtx, setReassignCtx] = useState<{ room: ReadyForInspectionRoom } | null>(null)
  const [reassignHkId, setReassignHkId] = useState('')
  const [reassignNote, setReassignNote] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [dateFrom, setDateFrom] = useState(sevenDaysAgoISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [resultFilter, setResultFilter] = useState('all')

  const queryClient = useQueryClient()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const { data: readyRooms = [], isLoading: isLoadingReady } = useQuery<ReadyForInspectionRoom[]>({
    queryKey: ['ready-for-inspection', todayISO()],
    queryFn: () => housekeepingApi.getReadyForInspection(todayISO()).then((res) => res.data),
    refetchInterval: 60_000,
  })

  const { data: inspections = [], isLoading: isLoadingHistory } = useQuery<InspectionRecord[]>({
    queryKey: ['housekeeping-inspections', dateFrom, dateTo, resultFilter],
    queryFn: () =>
      housekeepingApi
        .getInspections({
          date_from: dateFrom,
          date_to: dateTo,
          result: resultFilter === 'all' ? undefined : resultFilter,
        })
        .then((res) => res.data),
    enabled: tab === 'history',
  })

  const { data: staffData } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
    staleTime: 300_000,
  })
  const housekeepers = (staffData?.data?.staff ?? []).filter((s) => s.role === 'housekeeper')

  function handleInspectionSuccess(result: OverallResult) {
    const room = inspectingRoom!
    queryClient.invalidateQueries({ queryKey: ['ready-for-inspection'] })
    queryClient.invalidateQueries({ queryKey: ['housekeeping-inspections'] })
    setInspectingRoom(null)

    if (result === 'failed') {
      setReassignCtx({ room })
      setReassignHkId(room.housekeeper_id ?? '')
      setReassignNote('')
    } else {
      setToast({
        type: 'success',
        message:
          result === 'passed'
            ? `Room ${room.room_number} passed — marked Inspected.`
            : `Room ${room.room_number} saved as Conditional.`,
      })
    }
  }

  async function handleReassign() {
    if (!reassignCtx) return
    setReassignBusy(true)
    try {
      if (reassignHkId) {
        await housekeepingApi.saveAssignments({
          date: todayISO(),
          shift_id: null,
          assignments: [{ room_id: reassignCtx.room.room_id, housekeeper_id: reassignHkId }],
          is_ai_suggested: false,
        })
      }
      if (reassignNote.trim()) {
        await housekeepingApi.addNote(reassignCtx.room.room_id, reassignNote.trim())
      }
      queryClient.invalidateQueries({ queryKey: ['ready-for-inspection'] })
      const roomNum = reassignCtx.room.room_number
      setReassignCtx(null)
      setToast({ type: 'success', message: `Room ${roomNum} re-assigned for re-clean.` })
    } catch {
      setToast({ type: 'error', message: 'Failed to re-assign room.' })
    } finally {
      setReassignBusy(false)
    }
  }

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

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        eyebrow="Housekeeping"
        title="Inspections"
        subtitle="Inspect cleaned rooms — pass, flag conditional, or send back for re-clean."
      />

      {toast && (
        <div
          role="alert"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-[var(--ready-soft)] border-[var(--ready-line)] text-green-800'
              : 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-red-800'
          }`}
        >
          <CheckCircle2
            size={16}
            className={toast.type === 'success' ? 'text-[var(--ready)]' : 'text-[var(--alert)]'}
          />
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-line">
        {(['live', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-[var(--accent)] text-ink'
                : 'border-transparent text-ink3 hover:text-ink2'
            }`}
          >
            {t === 'live'
              ? `Live${readyRooms.length > 0 ? ` · ${readyRooms.length}` : ''}`
              : 'History'}
          </button>
        ))}
      </div>

      {/* LIVE TAB */}
      {tab === 'live' && (
        <div className="space-y-4">
          {isLoadingReady ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[72px] bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
              ))}
            </div>
          ) : readyRooms.length === 0 ? (
            <Card className="p-10 text-center">
              <ClipboardCheck className="w-10 h-10 text-ink4 mx-auto mb-3" />
              <p className="text-sm font-medium text-ink2">No rooms waiting for inspection</p>
              <p className="text-xs text-ink3 mt-1">
                Rooms appear here when a housekeeper marks them clean.
              </p>
            </Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              {readyRooms.map((room) => (
                <QueueCard
                  key={room.room_id}
                  room={room}
                  onInspect={() => setInspectingRoom(room)}
                />
              ))}
            </Card>
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === 'history' && (
        <div className="space-y-4">
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
            <Button variant="ghost" onClick={setToday} className="px-3 py-1.5 text-sm">
              Today
            </Button>
            <Button variant="ghost" onClick={setThisWeek} className="px-3 py-1.5 text-sm">
              This Week
            </Button>
            <div className="ml-auto">
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

          <Card className="p-0 overflow-hidden">
            {isLoadingHistory ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-surface-3 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-2 text-xs text-ink3 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Room</th>
                    <th className="text-left px-4 py-2.5">Inspector</th>
                    <th className="text-left px-4 py-2.5">Result</th>
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5 hidden sm:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-14 text-center text-sm text-ink3">
                        No inspections in this period
                      </td>
                    </tr>
                  ) : (
                    inspections.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-line-2 hover:bg-surface-2 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-medium text-ink">
                          {row.room_number}
                        </td>
                        <td className="px-4 py-3 text-ink2">{row.inspector_name || 'Unknown'}</td>
                        <td className="px-4 py-3">
                          {row.overall_result ? (
                            <Pill
                              tone={resultPillTone(row.overall_result as InspectionResult)}
                              size="sm"
                            >
                              {resultLabel(row.overall_result as InspectionResult)}
                            </Pill>
                          ) : (
                            <Pill tone="caution" size="sm">
                              Pending
                            </Pill>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink3 text-xs font-mono">
                          {format(parseISO(row.completed_at), 'MMM d, h:mm a')}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink3 hidden sm:table-cell max-w-[200px] truncate">
                          {row.notes ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {/* Inspection modal */}
      <InspectionModal
        roomId={inspectingRoom?.room_id ?? ''}
        roomNumber={inspectingRoom?.room_number ?? ''}
        cleanedBy={inspectingRoom?.cleaned_by}
        cleanedAt={inspectingRoom?.cleaned_at}
        cleanType={inspectingRoom?.clean_type}
        isOpen={!!inspectingRoom}
        onClose={() => setInspectingRoom(null)}
        onSuccess={handleInspectionSuccess}
      />

      {/* Re-assign drawer — shown after a failed inspection */}
      {reassignCtx && (
        <>
          <div
            className="fixed inset-0 bg-stone-900/10 z-40"
            onClick={() => setReassignCtx(null)}
            aria-hidden="true"
          />
          <div className="fixed bottom-0 inset-x-0 z-50 sm:bottom-6 sm:right-6 sm:left-auto sm:w-[380px]">
            <div className="bg-surface border border-line shadow-2xl rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] p-5">
              <p className="text-sm font-bold text-ink mb-0.5">
                Room {reassignCtx.room.room_number} failed — re-assign for re-clean
              </p>
              <p className="text-xs text-ink3 mb-4">
                The room has been returned to Dirty. Assign a housekeeper to re-clean.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1">Housekeeper</label>
                  <select
                    value={reassignHkId}
                    onChange={(e) => setReassignHkId(e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-surface"
                  >
                    <option value="">— select housekeeper —</option>
                    {housekeepers.map((hk) => (
                      <option key={hk.user_id} value={hk.user_id}>
                        {hk.full_name}
                        {hk.user_id === reassignCtx.room.housekeeper_id ? ' (original)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1">
                    Note for housekeeper{' '}
                    <span className="font-normal text-ink4">(optional)</span>
                  </label>
                  <textarea
                    value={reassignNote}
                    onChange={(e) => setReassignNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Towels not replaced, bathroom needs attention"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none bg-surface"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <Button
                  variant="ghost"
                  onClick={() => setReassignCtx(null)}
                  className="flex-1"
                >
                  Skip
                </Button>
                <Button
                  variant="primary"
                  onClick={handleReassign}
                  disabled={!reassignHkId || reassignBusy}
                  className="flex-1"
                >
                  {reassignBusy ? 'Re-assigning…' : 'Re-assign'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
