'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { format, addDays, parseISO } from 'date-fns'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { RoomStatusBoard } from '@/components/housekeeping/RoomStatusBoard'
import { AssignmentSidebar } from '@/components/housekeeping/AssignmentSidebar'
import { PredictionPanel } from '@/components/housekeeping/PredictionPanel'
import { RoomPrediction, housekeepingApi } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'

// ── Shift options ─────────────────────────────────────────────────────────────

const SHIFTS = [
  { value: '', label: 'All Shifts' },
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
]

// ── Synced-ago badge ──────────────────────────────────────────────────────────

function SyncBadge({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  const [label, setLabel] = useState('Never synced')

  useEffect(() => {
    function compute() {
      if (!lastSyncedAt) {
        setLabel('Never synced')
        return
      }
      const diffMs = Date.now() - lastSyncedAt.getTime()
      const diffMin = Math.floor(diffMs / 60_000)
      if (diffMin < 1) setLabel('Synced just now')
      else if (diffMin === 1) setLabel('Synced 1 min ago')
      else setLabel(`Synced ${diffMin} min ago`)
    }

    compute()
    const interval = setInterval(compute, 30_000)
    return () => clearInterval(interval)
  }, [lastSyncedAt])

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
      <span
        className={`w-2 h-2 rounded-full ${
          lastSyncedAt ? 'bg-green-400' : 'bg-gray-300'
        }`}
      />
      {label}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HousekeepingPage() {
  const queryClient = useQueryClient()
  const {
    selectedDate,
    selectedShift,
    assignmentMode,
    showRiskOnly,
    lastSyncedAt,
    rooms,
    setSelectedDate,
    setSelectedShift,
    toggleAssignmentMode,
    toggleRiskOnly,
    setLastSyncedAt,
  } = useHousekeepingStore()

  const [dragError, setDragError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const roomId = active.id as string
    const housekeeperId = over.data?.current?.housekeeperId as string | undefined
    if (!housekeeperId) return

    if (!selectedShift) {
      setDragError('Please select a shift before assigning rooms.')
      return
    }

    try {
      await housekeepingApi.saveAssignments({
        date: selectedDate,
        shift_id: selectedShift,
        assignments: [{ room_id: roomId, housekeeper_id: housekeeperId }],
        is_ai_suggested: false,
      })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
    } catch (error) {
      setDragError('Failed to assign room. Please try again.')
    }
  }

  const [predictions, setPredictions] = useState<RoomPrediction[]>([])
  const [predictionsLoading, setPredictionsLoading] = useState(false)

  // Fetch predictions on mount and when selectedDate changes
  useEffect(() => {
    const fetchPredictions = async () => {
      setPredictionsLoading(true)
      try {
        const res = await housekeepingApi.getPredictions()
        setPredictions(res.data?.rooms || [])
        setLastSyncedAt(new Date())
      } catch (e) {
        // silently fail — predictions are optional
      } finally {
        setPredictionsLoading(false)
      }
    }
    fetchPredictions()
  }, [selectedDate])

  // Navigate by relative day offset
  const navigate = (delta: number) => {
    const current = parseISO(selectedDate)
    setSelectedDate(format(addDays(current, delta), 'yyyy-MM-dd'))
  }

  // Human-readable date label
  const dateLabel = format(parseISO(selectedDate), 'MMM d, yyyy')

  // Summary stats from unfiltered rooms
  const totalRooms = rooms.length
  const needAttention = rooms.filter(
    (r) => r.status === 'DIRTY' || r.status === 'IN_PROGRESS',
  ).length
  const readyRooms = rooms.filter((r) => r.status === 'INSPECTED').length
  const highRiskCount = predictions.filter((p) => p.risk_level === 'HIGH').length

  return (
    <div className="space-y-4">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: title + date nav + shift */}
        <div className="space-y-2">
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Housekeeping Board</h1>

          <div className="flex flex-wrap items-center gap-2">
            {/* Prev day */}
            <Button
              variant="ghost"
              onClick={() => navigate(-1)}
              className="px-2 py-1 text-sm"
              aria-label="Previous day"
            >
              &larr; {format(addDays(parseISO(selectedDate), -1), 'MMM d')}
            </Button>

            {/* Current date */}
            <span className="px-3 py-1 rounded-lg bg-white/70 backdrop-blur-sm border border-white/90 text-sm font-medium text-gray-900">
              {dateLabel}
            </span>

            {/* Next day */}
            <Button
              variant="ghost"
              onClick={() => navigate(1)}
              className="px-2 py-1 text-sm"
              aria-label="Next day"
            >
              {format(addDays(parseISO(selectedDate), 1), 'MMM d')} &rarr;
            </Button>

            {/* Shift selector */}
            <select
              value={selectedShift ?? ''}
              onChange={(e) => setSelectedShift(e.target.value || null)}
              className="ml-1 px-3 py-1 rounded-lg border border-white/90 text-sm text-gray-700 bg-white/70 backdrop-blur-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            >
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: view/assign toggle + at-risk + add rooms */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View / Assign mode toggle */}
          <div className="inline-flex rounded-lg border border-white/90 overflow-hidden text-sm bg-white/70 backdrop-blur-sm">
            <button
              onClick={() => assignmentMode && toggleAssignmentMode()}
              className={`px-3 py-1.5 font-medium transition-colors ${
                !assignmentMode
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-700 hover:bg-white/50'
              }`}
            >
              View Mode
            </button>
            <button
              onClick={() => !assignmentMode && toggleAssignmentMode()}
              className={`px-3 py-1.5 font-medium transition-colors ${
                assignmentMode
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-700 hover:bg-white/50'
              }`}
            >
              Assign Mode
            </button>
          </div>

          {/* At Risk filter */}
          <Button
            variant={showRiskOnly ? 'primary' : 'ghost'}
            onClick={toggleRiskOnly}
            className={`px-3 py-1.5 text-sm ${showRiskOnly ? 'bg-orange-500 hover:bg-orange-600' : ''}`}
          >
            <span className="text-base leading-none">&#9888;</span>
            At Risk Only
          </Button>

          {/* Add rooms link */}
          <Link
            href="/onboarding?step=2"
            className="px-3 py-1.5 rounded-lg border border-white/90 bg-white/70 backdrop-blur-sm text-sm text-gray-700 hover:bg-white/90 transition-colors"
          >
            + Add Rooms
          </Link>
        </div>
      </div>

      {/* ── Sync badge + summary stats ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Stats */}
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>
            <strong className="text-gray-900">{totalRooms}</strong> total rooms
          </span>
          <span>
            <strong className="text-orange-600">{needAttention}</strong> need attention
          </span>
          <span>
            <strong className="text-green-600">{readyRooms}</strong> ready
          </span>
          {highRiskCount > 0 && (
            <span>
              <strong className="text-red-600">{highRiskCount}</strong> at risk
            </span>
          )}
        </div>

        {/* Sync indicator */}
        <SyncBadge lastSyncedAt={lastSyncedAt} />
      </div>

      {/* ── Prediction Alerts ──────────────────────────────────────────────── */}
      {predictions.some((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM') && (
        <PredictionPanel predictions={predictions} isLoading={predictionsLoading} />
      )}

      {/* ── Drag error banner ─────────────────────────────────────────────── */}
      {dragError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <span>{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="shrink-0 text-red-500 hover:text-red-700 font-medium"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 items-start">
          {/* Board */}
          <div className="flex-1 min-w-0">
            <RoomStatusBoard />
          </div>

          {/* Sidebar — only in assign mode */}
          {assignmentMode && <AssignmentSidebar />}
        </div>
      </DndContext>
    </div>
  )
}
