'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDroppable } from '@dnd-kit/core'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

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
          className="h-full bg-amber-600 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {done}/{total}
      </span>
    </div>
  )
}

// ── Drop zone row per housekeeper ─────────────────────────────────────────────

interface HousekeeperDropRowProps {
  hk: HousekeeperAssignment
  roomNumberMap: Record<string, string>
  pendingAssignments: Record<string, string>
  removePendingAssignment: (roomId: string) => void
}

function HousekeeperDropRow({
  hk,
}: HousekeeperDropRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `hk-${hk.housekeeper_id}`,
    data: { housekeeperId: hk.housekeeper_id },
  })

  return (
    <div
      ref={setNodeRef}
      className={`px-4 py-3 transition-colors rounded-lg mx-1 my-0.5 ${
        isOver
          ? 'bg-[var(--caution-soft)] border-2 border-amber-400 border-dashed'
          : 'border-2 border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
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

      {/* Drop hint */}
      {isOver && (
        <p className="text-xs text-[var(--caution)] font-medium mt-1.5 text-center">
          Drop to assign
        </p>
      )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-5">
        <h3 className="font-semibold text-gray-900 text-base mb-1">AI Assignment Suggestions</h3>
        <p className="text-xs text-gray-500 mb-4">
          Based on workload, skill level, and current occupancy.
        </p>

        <div className="space-y-3 mb-5">
          {suggestions.map((s) => (
            <Card key={s.housekeeper_id} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">{s.housekeeper_name}</span>
                <span className="text-xs text-gray-400">Est. {s.estimated_finish}</span>
              </div>
              <p className="text-xs text-gray-600">
                Rooms: {s.rooms.join(', ')}
              </p>
            </Card>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={onApply}
            className="flex-1 py-2"
          >
            Apply All Suggestions
          </Button>
          <Button
            variant="ghost"
            onClick={onDismiss}
            className="flex-1 py-2"
          >
            Dismiss
          </Button>
        </div>
      </Card>
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
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Fetch assignments ───────────────────────────────────────────────────
  const { data: assignmentsData, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['housekeeping-assignments', selectedDate],
    queryFn: () => housekeepingApi.getAssignments(selectedDate, selectedShift ?? undefined),
  })

  const housekeepers: HousekeeperAssignment[] = (assignmentsData as any)?.data ?? []

  // ── Fetch all HK staff — shown by default, enriched with today's assignment data ──
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })
  const housekeeperStaff = (staffData?.data?.staff ?? []).filter(
    (s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor',
  )

  // All HK staff shown automatically; enrich with live assignment data when available
  const mergedHousekeepers: HousekeeperAssignment[] = housekeeperStaff.map((s: any) => {
    const existing = housekeepers.find((h) => h.housekeeper_id === s.user_id)
    return existing ?? {
      housekeeper_id: s.user_id,
      name: s.full_name,
      rooms_assigned: 0,
      rooms_done: 0,
      total_rooms: 0,
      current_room: null,
      current_room_status: null,
    }
  })

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
    setSaveSuccessMsg(null)

    // Count new assignments vs reassignments before the save clears state
    const reassignCount = Object.entries(pendingAssignments).filter(([roomId, hkId]) => {
      const r = rooms.find((r: any) => r.room_id === roomId)
      return r?.assigned_to && r.assigned_to !== hkId
    }).length
    const newCount = Object.keys(pendingAssignments).length - reassignCount

    try {
      await housekeepingApi.saveAssignments({
        date: selectedDate,
        shift_id: null,
        assignments: Object.entries(pendingAssignments)
          .filter(([roomId, housekeeperId]) => !!roomId && !!housekeeperId)
          .map(([roomId, housekeeperId]) => ({
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
      const parts: string[] = []
      if (newCount > 0) parts.push(`${newCount} assignment${newCount !== 1 ? 's' : ''} saved`)
      if (reassignCount > 0) parts.push(`${reassignCount} room${reassignCount !== 1 ? 's' : ''} reassigned`)
      setSaveSuccessMsg(parts.join(', ') + '.')
      setTimeout(() => setSaveSuccessMsg(null), 3000)
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

      <Card className="w-72 shrink-0 flex flex-col overflow-hidden h-fit max-h-[calc(100vh-10rem)] p-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/60">
          <h3 className="font-semibold text-gray-900 text-sm">Housekeepers</h3>
          <p className="text-xs text-gray-400 mt-0.5">Drag a room card onto a name to assign</p>
        </div>

        {/* Housekeeper list */}
        <div className="flex-1 overflow-y-auto py-1">
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
          ) : mergedHousekeepers.length === 0 ? (
            <p className="p-4 text-xs text-gray-400 text-center">
              No housekeeping staff found.
            </p>
          ) : (
            <div className="divide-y divide-white/60">
              {mergedHousekeepers.map((hk) => (
                <HousekeeperDropRow
                  key={hk.housekeeper_id}
                  hk={hk}
                  roomNumberMap={roomNumberMap}
                  pendingAssignments={pendingAssignments}
                  removePendingAssignment={removePendingAssignment}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pending assignments */}
        {hasPending && (
          <div className="border-t border-white/60 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">Pending Changes</span>
              <span className="inline-flex items-center justify-center w-5 h-5 bg-yellow-500 text-white text-xs font-bold rounded-full">
                {Object.keys(pendingAssignments).length}
              </span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {Object.entries(pendingAssignments).map(([roomId, housekeeperId]) => {
                const roomNumber = roomNumberMap[roomId] ?? roomId
                const toHk = mergedHousekeepers.find((h) => h.housekeeper_id === housekeeperId)
                const currentAssignedTo = rooms.find((r: any) => r.room_id === roomId)?.assigned_to
                const fromHk = currentAssignedTo && currentAssignedTo !== housekeeperId
                  ? mergedHousekeepers.find((h) => h.housekeeper_id === currentAssignedTo)
                  : null
                return (
                  <div key={roomId} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      Room {roomNumber}{' '}
                      {fromHk ? (
                        <>
                          <span className="line-through text-gray-400">{fromHk.name.split(' ')[0]}</span>
                          {' '}&rarr;{' '}
                          <span className="font-medium text-[var(--caution)]">{toHk?.name ?? housekeeperId}</span>
                        </>
                      ) : (
                        <>
                          &rarr;{' '}
                          <span className="font-medium text-gray-800">{toHk?.name ?? housekeeperId}</span>
                        </>
                      )}
                    </span>
                    <button
                      onClick={() => removePendingAssignment(roomId)}
                      className="text-gray-400 hover:text-[var(--alert)] transition-colors ml-2"
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
        {saveSuccessMsg && (
          <div className="mx-4 mb-2 px-3 py-2 bg-[var(--ready-soft)] text-[var(--ready)] text-xs rounded-lg">
            {saveSuccessMsg}
          </div>
        )}
        {saveError && (
          <div className="mx-4 mb-2 px-3 py-2 bg-[var(--alert-soft)] text-[var(--alert)] text-xs rounded-lg">
            {saveError}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 py-3 border-t border-white/60 space-y-2">
          <Button
            variant="primary"
            onClick={handleAiSuggest}
            disabled={aiLoading}
            className="w-full py-2 bg-purple-600 hover:bg-purple-700"
          >
            {aiLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Thinking...
              </>
            ) : (
              'AI Auto-Assign'
            )}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasPending || saveLoading}
            className="w-full py-2"
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
                  <span className="inline-flex items-center justify-center w-5 h-5 bg-surface text-accent text-xs font-bold rounded-full">
                    {Object.keys(pendingAssignments).length}
                  </span>
                )}
              </>
            )}
          </Button>
        </div>
      </Card>
    </>
  )
}
