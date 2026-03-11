'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HousekeeperAssignment {
  housekeeper_id: string
  name: string
  rooms_assigned: number
  rooms_done: number
  total_rooms: number
  current_room?: string | null
  current_room_status?: string | null
}

interface AISuggestion {
  housekeeper_id: string
  housekeeper_name: string
  rooms: string[]
  estimated_finish: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-600 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {done}/{total}
      </span>
    </div>
  )
}

// ── AI Suggestions overlay ────────────────────────────────────────────────────

interface AISuggestionsOverlayProps {
  suggestions: AISuggestion[]
  onApply: () => void
  onDismiss: () => void
}

function AISuggestionsOverlay({ suggestions, onApply, onDismiss }: AISuggestionsOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <h3 className="font-semibold text-gray-900 text-base mb-1">AI Assignment Suggestions</h3>
        <p className="text-xs text-gray-500 mb-4">
          Based on workload, skill level, and current occupancy.
        </p>

        <div className="space-y-3 mb-5">
          {suggestions.map((s) => (
            <div key={s.housekeeper_id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">{s.housekeeper_name}</span>
                <span className="text-xs text-gray-400">Est. {s.estimated_finish}</span>
              </div>
              <p className="text-xs text-gray-600">
                Rooms: {s.rooms.join(', ')}
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onApply}
            className="flex-1 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
          >
            Apply All Suggestions
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AssignmentSidebar() {
  const queryClient = useQueryClient()

  const {
    selectedDate,
    selectedShift,
    pendingAssignments,
    setPendingAssignment,
    removePendingAssignment,
    clearPendingAssignments,
    rooms,
  } = useHousekeepingStore()

  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[] | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Fetch assignments ───────────────────────────────────────────────────
  const { data: assignmentsData, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['housekeeping-assignments', selectedDate],
    queryFn: () => housekeepingApi.getAssignments(selectedDate, selectedShift ?? undefined),
  })

  const housekeepers: HousekeeperAssignment[] = (assignmentsData as any)?.data ?? []

  // ── Build a room number lookup from the board store rooms ─────────────
  const roomNumberMap = rooms.reduce<Record<string, string>>((acc, r) => {
    if (r.room_id && r.rooms?.room_number) acc[r.room_id] = r.rooms.room_number
    return acc
  }, {})

  // ── AI auto-assign ─────────────────────────────────────────────────────
  const handleAiSuggest = async () => {
    setAiLoading(true)
    try {
      const res = await housekeepingApi.aiSuggestAssignments(
        selectedDate,
        selectedShift ?? undefined,
      )
      const suggestions: AISuggestion[] = (res as any)?.data?.suggestions ?? []
      setAiSuggestions(suggestions)
    } catch {
      // silently fail — user can retry
    } finally {
      setAiLoading(false)
    }
  }

  const handleApplyAiSuggestions = () => {
    if (!aiSuggestions) return
    for (const s of aiSuggestions) {
      for (const roomId of s.rooms) {
        setPendingAssignment(roomId, s.housekeeper_id)
      }
    }
    setAiSuggestions(null)
  }

  // ── Save assignments ───────────────────────────────────────────────────
  const hasPending = Object.keys(pendingAssignments).length > 0

  const handleSave = async () => {
    if (!hasPending) return
    setSaveLoading(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await housekeepingApi.saveAssignments({
        date: selectedDate,
        shift_id: selectedShift ?? '',
        assignments: Object.entries(pendingAssignments).map(([roomId, housekeeperId]) => ({
          room_id: roomId,
          housekeeper_id: housekeeperId,
        })),
        is_ai_suggested: false,
      })
      clearPendingAssignments()
      queryClient.invalidateQueries({
        queryKey: ['housekeeping-board', selectedDate, selectedShift],
      })
      queryClient.invalidateQueries({
        queryKey: ['housekeeping-assignments', selectedDate],
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save assignments')
    } finally {
      setSaveLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      {aiSuggestions && (
        <AISuggestionsOverlay
          suggestions={aiSuggestions}
          onApply={handleApplyAiSuggestions}
          onDismiss={() => setAiSuggestions(null)}
        />
      )}

      <aside className="w-72 shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden h-fit max-h-[calc(100vh-10rem)]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Housekeepers Today</h3>
        </div>

        {/* Housekeeper list */}
        <div className="flex-1 overflow-y-auto">
          {assignmentsLoading ? (
            <div className="p-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2 animate-pulse">
                  <div className="flex gap-2">
                    <div className="w-8 h-8 bg-gray-200 rounded-full" />
                    <div className="flex-1 h-4 bg-gray-200 rounded" />
                  </div>
                  <div className="h-2 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          ) : housekeepers.length === 0 ? (
            <p className="p-4 text-xs text-gray-400 text-center">
              No housekeepers assigned yet for this date.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {housekeepers.map((hk) => (
                <div key={hk.housekeeper_id} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {getInitials(hk.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{hk.name}</p>
                      {hk.current_room && (
                        <p className="text-xs text-gray-400 truncate">
                          {hk.current_room_status === 'IN_PROGRESS' ? 'Cleaning' : 'In'} Room{' '}
                          {hk.current_room}
                        </p>
                      )}
                    </div>
                    <span className="ml-auto text-xs text-gray-400 shrink-0">
                      {hk.rooms_done} done
                    </span>
                  </div>
                  <ProgressBar done={hk.rooms_done} total={hk.total_rooms} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending assignments */}
        {hasPending && (
          <div className="border-t border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">Pending Changes</span>
              <span className="inline-flex items-center justify-center w-5 h-5 bg-yellow-500 text-white text-xs font-bold rounded-full">
                {Object.keys(pendingAssignments).length}
              </span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {Object.entries(pendingAssignments).map(([roomId, housekeeperId]) => {
                const roomNumber = roomNumberMap[roomId] ?? roomId
                const hk = housekeepers.find((h) => h.housekeeper_id === housekeeperId)
                return (
                  <div key={roomId} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      Room {roomNumber} &rarr;{' '}
                      <span className="font-medium text-gray-800">
                        {hk?.name ?? housekeeperId}
                      </span>
                    </span>
                    <button
                      onClick={() => removePendingAssignment(roomId)}
                      className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                      aria-label="Remove pending assignment"
                    >
                      &times;
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Success / error feedback */}
        {saveSuccess && (
          <div className="mx-4 mb-2 px-3 py-2 bg-green-50 text-green-700 text-xs rounded-lg">
            Assignments saved successfully.
          </div>
        )}
        {saveError && (
          <div className="mx-4 mb-2 px-3 py-2 bg-red-50 text-red-700 text-xs rounded-lg">
            {saveError}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 py-3 border-t border-gray-100 space-y-2">
          <button
            onClick={handleAiSuggest}
            disabled={aiLoading}
            className="w-full flex items-center justify-center gap-2 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {aiLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Thinking...
              </>
            ) : (
              'AI Auto-Assign'
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={!hasPending || saveLoading}
            className="w-full flex items-center justify-center gap-2 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {saveLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Save Assignments
                {hasPending && (
                  <span className="inline-flex items-center justify-center w-5 h-5 bg-white text-brand-600 text-xs font-bold rounded-full">
                    {Object.keys(pendingAssignments).length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
