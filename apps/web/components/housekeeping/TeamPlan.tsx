'use client'

/**
 * Housekeeping · Team Plan — supervisor team execution plan (real data).
 *
 * Answers, at a glance: who is working, how much load they carry, what room
 * they're on now, what's next, which priority rooms are at risk, which rooms
 * are unassigned, and whether the plan creates unnecessary building/floor
 * travel. It is deliberately not a second Tasks/analytics/AI/assignment
 * screen — staging and publishing assignments stays owned by the Phase 6
 * Assignment Workspace, which this view hands off to via onOpenAssignment.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { hotelsApi } from '@/lib/api/hotels'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { staffApi } from '@/lib/api/staff'
import { shiftsApi } from '@/lib/api/shifts'
import { schedulingApi } from '@/lib/api/scheduling'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/hooks/useRole'
import { getDisplayName } from '@/lib/utils/avatar'
import { normalizeHousekeepingBoardRoom } from '@/lib/utils/housekeepingBoardFilters'
import { getDefaultWorkloadTarget, normalizeHousekeepingRoom, type HousekeepingOperationalRoom } from '@/lib/housekeeping/roomState'
import { getStaffShiftInfo } from '@/lib/housekeeping/assignmentView'
import {
  buildTeamPlanAttentionItems,
  buildTeamPlanLanes,
  buildTeamPlanTimeWindow,
  buildUnassignedTeamPool,
  splitTeamPlanLanes,
} from '@/lib/housekeeping/teamPlanView'
import { TeamPlanLane, TEAM_PLAN_IDENTITY_WIDTH, TEAM_PLAN_PX_PER_MINUTE } from '@/components/housekeeping/TeamPlanLane'
import { TeamPlanUnassigned } from '@/components/housekeeping/TeamPlanUnassigned'
import { TeamPlanAttention } from '@/components/housekeeping/TeamPlanAttention'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { Button } from '@/components/ui/Button'

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

interface Props {
  /** Hands off to the Phase 6 Assignment Workspace, optionally pre-selecting rooms. */
  onOpenAssignment: (roomIds?: string[]) => void
}

export function TeamPlan({ onOpenAssignment }: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)
  const { canAssignRooms } = useRole()

  const {
    rooms: rawRooms,
    setRooms,
    setLastSyncedAt,
    selectedDate,
    selectedShift,
    pendingAssignments,
    pendingAssignmentCleanTypes,
  } = useHousekeepingStore()

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  const { data: boardData, isLoading, isError, refetch } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(selectedDate, selectedShift ?? undefined, true),
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (!boardData) return
    setRooms((boardData as any)?.data ?? [])
    setLastSyncedAt(new Date())
  }, [boardData, setRooms, setLastSyncedAt])

  const { data: staffData } = useQuery({ queryKey: ['staff-list'], queryFn: () => staffApi.list() })
  const { data: workloadSettings } = useQuery({ queryKey: ['housekeeping-settings', hotelId], queryFn: () => hotelsApi.getHousekeepingSettings(hotelId), enabled: !!hotelId })
  const { data: rosterData } = useQuery({ queryKey: ['shift-roster', selectedDate], queryFn: () => shiftsApi.getRoster(selectedDate) })
  const { data: scheduleData } = useQuery({
    queryKey: ['schedule-assignments', selectedDate],
    queryFn: () => schedulingApi.listAssignments({ work_date: selectedDate }),
  })
  const { data: guestRequestsData, isError: guestRequestsError } = useQuery({
    queryKey: ['guest-requests-board'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  // -- Realtime: room status + assignment changes update lanes without a full page refresh --
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!hotelId) return
    if (session?.access_token) supabase.realtime.setAuth(session.access_token)

    const invalidate = () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      realtimeDebounce.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      }, 500)
    }

    const channel = supabase
      .channel('team_plan_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_status', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .subscribe()

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
  }, [hotelId, queryClient, selectedDate, selectedShift, session?.access_token, supabase])

  // -- Derived data ------------------------------------------------------------
  const nameById = useMemo(() =>
    ((staffData as any)?.data?.staff ?? []).reduce((acc: Record<string, string>, s: any) => {
      acc[s.user_id] = getDisplayName(s.full_name)
      return acc
    }, {}),
    [staffData],
  )

  const housekeepers = useMemo(() =>
    ((staffData as any)?.data?.staff ?? [])
      .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
      .map((s: any) => ({ id: s.user_id as string, name: getDisplayName(s.full_name) })),
    [staffData],
  )

  const shiftByUser = useMemo(() => {
    const rows = rosterData?.data ?? []
    const map: Record<string, (typeof rows)[number]> = {}
    for (const row of rows) map[row.user_id] = row
    return map
  }, [rosterData])

  const scheduledUserIds = useMemo(() => new Set<string>(((scheduleData as any)?.data ?? []).map((row: any) => row.user_id)), [scheduleData])

  const shiftInfoById = useMemo(() => {
    const info: Record<string, ReturnType<typeof getStaffShiftInfo>> = {}
    for (const hk of housekeepers) info[hk.id] = getStaffShiftInfo(shiftByUser[hk.id], scheduledUserIds.has(hk.id))
    return info
  }, [housekeepers, shiftByUser, scheduledUserIds])

  const cleaningRoomNumberById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const raw of rawRooms) {
      if (raw.status === 'IN_PROGRESS' && raw.assigned_to) map[raw.assigned_to] = raw.rooms?.room_number ?? raw.room_number ?? ''
    }
    return map
  }, [rawRooms])

  const operationalRooms: HousekeepingOperationalRoom[] = useMemo(
    () => rawRooms.map((raw: any) => normalizeHousekeepingRoom(normalizeHousekeepingBoardRoom(raw))),
    [rawRooms],
  )

  const target = getDefaultWorkloadTarget(workloadSettings?.data)
  const targetsByStaff = workloadSettings?.data.capacity_overrides
  const creditWeights = workloadSettings?.data.credit_weights
  const now = new Date()

  const lanes = useMemo(() => buildTeamPlanLanes({
    staff: housekeepers,
    rooms: operationalRooms,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    shiftInfoById,
    cleaningRoomNumberById,
    target,
    targetsByStaff,
    creditWeights,
    now,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [housekeepers, operationalRooms, pendingAssignments, pendingAssignmentCleanTypes, shiftInfoById, cleaningRoomNumberById, target, targetsByStaff, creditWeights])

  const { onShift: onShiftLanes, offShift: offShiftLanes } = useMemo(() => splitTeamPlanLanes(lanes), [lanes])

  const timeWindow = useMemo(() => buildTeamPlanTimeWindow(onShiftLanes, now), [onShiftLanes]) // eslint-disable-line react-hooks/exhaustive-deps
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  const laneWidthPx = Math.max((timeWindow.endMinute - timeWindow.startMinute) * TEAM_PLAN_PX_PER_MINUTE, 640)
  const nowLeftPx = (nowMinute - timeWindow.startMinute) * TEAM_PLAN_PX_PER_MINUTE

  const pool = useMemo(() => buildUnassignedTeamPool(operationalRooms, pendingAssignments), [operationalRooms, pendingAssignments])

  const relevantGuestRequests = useMemo(() => {
    const all: GuestRequest[] = (guestRequestsData as any)?.data ?? []
    return all.filter((r) => ['open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'reopened'].includes(r.status))
  }, [guestRequestsData])

  const attentionItems = useMemo(
    () => buildTeamPlanAttentionItems({ rooms: operationalRooms, guestRequests: relevantGuestRequests, nameById }),
    [operationalRooms, relevantGuestRequests, nameById],
  )

  // -- Actions -------------------------------------------------------------
  function handleOpenRoom(roomId: string) {
    const raw = rawRooms.find((r: any) => r.room_id === roomId)
    if (raw) setSelectedRoom(raw)
  }

  function handleAssignRoom(roomId: string) {
    onOpenAssignment([roomId])
  }

  function handleRebalance(housekeeperId: string) {
    void housekeeperId
    onOpenAssignment()
  }

  function handleOpenGuestRequest() {
    router.push('/tasks?type=guest_request')
  }

  if (!canAssignRooms) {
    return (
      <div className="flex items-center justify-center h-64">
        <EmptyState title={t('housekeeping.teamPlan.noAccess')} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton variant="card" className="h-40" />
        <Skeleton variant="card" className="h-24" />
        <Skeleton variant="card" className="h-32" />
      </div>
    )
  }

  if (isError) {
    return (
      <StateBlock
        status="error"
        error={{ message: t('housekeeping.roomStatus.error.failedToLoad'), onRetry: refetch }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--r-lg)] border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <div style={{ minWidth: TEAM_PLAN_IDENTITY_WIDTH + laneWidthPx }}>
            <div
              className="grid border-b border-line bg-surface-2"
              style={{ gridTemplateColumns: `${TEAM_PLAN_IDENTITY_WIDTH}px ${laneWidthPx}px` }}
            >
              <div className="sticky left-0 z-[2] border-r border-line bg-surface-2 p-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">
                {t('housekeeping.teamPlan.onShift', { n: onShiftLanes.length })}
              </div>
              <div className="relative h-9">
                {timeWindow.hourMarks.map((mark) => (
                  <div
                    key={mark.minute}
                    className="absolute top-0 bottom-0 flex items-center border-l border-line pl-1.5 font-mono text-[11px] text-ink3"
                    style={{ left: (mark.minute - timeWindow.startMinute) * TEAM_PLAN_PX_PER_MINUTE }}
                  >
                    {mark.label}
                  </div>
                ))}
                <div className="absolute top-0 bottom-0 flex items-center border-l-[1.5px] border-[var(--accent)]" style={{ left: nowLeftPx }}>
                  <span className="ml-1.5 rounded-[var(--r-sm)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                    {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now)}
                  </span>
                </div>
              </div>
            </div>

            {onShiftLanes.length === 0 ? (
              <p className="p-6 text-sm text-ink3">{t('housekeeping.teamPlan.noStaff')}</p>
            ) : (
              onShiftLanes.map((lane) => (
                <TeamPlanLane
                  key={lane.id}
                  lane={lane}
                  windowStartMinute={timeWindow.startMinute}
                  laneWidthPx={laneWidthPx}
                  nowLeftPx={nowLeftPx}
                  onOpenRoom={handleOpenRoom}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {offShiftLanes.length > 0 && (
        <details className="rounded-[var(--r-lg)] border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">
            {t('housekeeping.teamPlan.offShift', { n: offShiftLanes.length })}
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-ink3">
            {offShiftLanes.map((lane) => <li key={lane.id}>{lane.name}</li>)}
          </ul>
        </details>
      )}

      <TeamPlanUnassigned
        rooms={pool.rooms}
        totalCredits={pool.totalCredits}
        canAssign={canAssignRooms}
        onOpenRoom={handleOpenRoom}
        onAssignRoom={handleAssignRoom}
      />

      {guestRequestsError && (
        <p className="text-xs text-ink3">{t('housekeeping.teamPlan.guestRequestsError')}</p>
      )}

      <TeamPlanAttention
        items={attentionItems}
        canAssign={canAssignRooms}
        onOpenRoom={handleOpenRoom}
        onAssignRoom={handleAssignRoom}
        onRebalance={handleRebalance}
        onOpenGuestRequest={handleOpenGuestRequest}
      />

      {canAssignRooms && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenAssignment()}>
            {t('housekeeping.teamPlan.openAssignmentWorkspace')}
          </Button>
        </div>
      )}

      <RoomDetailDrawer room={selectedRoom} isOpen={selectedRoom !== null} onClose={() => setSelectedRoom(null)} />
    </div>
  )
}
