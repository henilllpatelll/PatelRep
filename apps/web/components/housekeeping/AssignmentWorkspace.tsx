'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { hotelsApi } from '@/lib/api/hotels'
import { staffApi } from '@/lib/api/staff'
import { shiftsApi } from '@/lib/api/shifts'
import { schedulingApi } from '@/lib/api/scheduling'
import { createClient } from '@/lib/supabase/client'
import { getDisplayName } from '@/lib/utils/avatar'
import { CLEAN_TYPE_OPTIONS, isOpenHousekeepingRoom, type CleanType } from '@/lib/utils/cleanType'
import { normalizeHousekeepingBoardRoom } from '@/lib/utils/housekeepingBoardFilters'
import {
  getDefaultWorkloadTarget,
  getRoomWorkloadCredits,
  normalizeHousekeepingRoom,
  type HousekeepingOperationalRoom,
} from '@/lib/housekeeping/roomState'
import { filterHousekeepingBoardView } from '@/lib/housekeeping/boardView'
import {
  buildStaffLoads,
  filterAssignmentPoolByTab,
  getAssignmentPoolTabCounts,
  getStagedChangesList,
  getStaffShiftInfo,
  roomNeedsCleanTypePrompt,
  sortAssignmentPool,
  type AssignmentPoolRoom,
} from '@/lib/housekeeping/assignmentView'
import { AssignmentRoomPool } from '@/components/housekeeping/AssignmentRoomPool'
import { AssignmentTeamPanel } from '@/components/housekeeping/AssignmentTeamPanel'
import { AssignmentAutoBalance } from '@/components/housekeeping/AssignmentAutoBalance'
import { StagedChangesPanel } from '@/components/housekeeping/StagedChangesPanel'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

export function AssignmentWorkspace() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)

  const {
    rooms: allRooms,
    setRooms,
    selectedDate,
    selectedShift,
    buildingFilter,
    floorFilter,
    cleanTypeFilter,
    boardSearch,
    assignFilter,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    setPendingAssignment,
    removePendingAssignment,
    clearPendingAssignments,
    selectedRoomIds,
    clearRoomSelection,
    setLastSyncedAt,
  } = useHousekeepingStore()

  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [cleanTypePrompt, setCleanTypePrompt] = useState<{ roomId: string; roomNumber: string; staffId: string } | null>(null)
  const [showAutoBalance, setShowAutoBalance] = useState(false)
  const [showStagedChanges, setShowStagedChanges] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // -- Data loading -------------------------------------------------------
  const { data: boardData, isLoading, isError } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(selectedDate, selectedShift ?? undefined, true),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (!boardData) return
    const rows: any[] = (boardData as any)?.data ?? []
    setRooms(rows)
    setLastSyncedAt(new Date())
    setSelectedRoom((prev: any) => (prev ? rows.find((r: any) => r.room_id === prev.room_id) ?? prev : prev))
  }, [boardData, setLastSyncedAt, setRooms])

  const { data: staffData } = useQuery({ queryKey: ['staff-list'], queryFn: () => staffApi.list() })
  const { data: workloadSettings } = useQuery({ queryKey: ['housekeeping-settings', hotelId], queryFn: () => hotelsApi.getHousekeepingSettings(hotelId), enabled: !!hotelId })
  const { data: rosterData } = useQuery({
    queryKey: ['shift-roster', selectedDate],
    queryFn: () => shiftsApi.getRoster(selectedDate),
  })
  const { data: scheduleData } = useQuery({
    queryKey: ['schedule-assignments', selectedDate],
    queryFn: () => schedulingApi.listAssignments({ work_date: selectedDate }),
  })

  // -- Realtime ------------------------------------------------------------
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
      .channel('assignment_workspace_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_status', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .subscribe()

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
  }, [hotelId, queryClient, selectedDate, selectedShift, session?.access_token, supabase])

  // -- Derived data ---------------------------------------------------------
  const nameById = useMemo(() =>
    ((staffData?.data?.staff ?? []) as any[]).reduce<Record<string, string>>((acc, s) => {
      acc[s.user_id] = getDisplayName(s.full_name)
      return acc
    }, {}),
    [staffData],
  )

  const housekeepers = useMemo(() =>
    ((staffData?.data?.staff ?? []) as any[])
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

  const scheduledUserIds = useMemo(() => {
    const rows = (scheduleData as any)?.data ?? []
    return new Set<string>(rows.map((row: any) => row.user_id))
  }, [scheduleData])

  const shiftInfoById = useMemo(() => {
    const info: Record<string, ReturnType<typeof getStaffShiftInfo>> = {}
    for (const hk of housekeepers) {
      info[hk.id] = getStaffShiftInfo(shiftByUser[hk.id], scheduledUserIds.has(hk.id))
    }
    return info
  }, [housekeepers, shiftByUser, scheduledUserIds])

  const cleaningRoomNumberById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const raw of allRooms) {
      if (raw.status === 'IN_PROGRESS' && raw.assigned_to) {
        map[raw.assigned_to] = raw.rooms?.room_number ?? raw.room_number ?? ''
      }
    }
    return map
  }, [allRooms])

  const target = getDefaultWorkloadTarget(workloadSettings?.data)
  const targetsByStaff = workloadSettings?.data.capacity_overrides
  const creditWeights = workloadSettings?.data.credit_weights

  const openPoolRooms: AssignmentPoolRoom[] = useMemo(() =>
    allRooms
      .filter((raw: any) => isOpenHousekeepingRoom({ status: raw.status }))
      .map((raw: any): AssignmentPoolRoom => ({
        roomId: raw.room_id,
        roomNumber: raw.rooms?.room_number ?? raw.room_number ?? '',
        floor: typeof raw.rooms?.floor === 'number' ? raw.rooms.floor : null,
        building: raw.rooms?.building ?? null,
        cleanType: (raw.clean_type as CleanType) ?? null,
        assignedTo: raw.assigned_to ?? null,
      })),
    [allRooms],
  )

  const staffLoads = useMemo(() => buildStaffLoads({
    staff: housekeepers,
    openRooms: openPoolRooms,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    shiftInfoById,
    cleaningRoomNumberById,
    target,
    targetsByStaff,
    creditWeights,
  }), [housekeepers, openPoolRooms, pendingAssignments, pendingAssignmentCleanTypes, shiftInfoById, cleaningRoomNumberById, target, targetsByStaff, creditWeights])

  const operationalRooms: HousekeepingOperationalRoom[] = useMemo(() =>
    allRooms.map((raw: any) => normalizeHousekeepingRoom(normalizeHousekeepingBoardRoom(raw))),
    [allRooms],
  )
  const allOpenOperationalRooms = useMemo(
    () => operationalRooms.filter((room) => isOpenHousekeepingRoom({ status: room.housekeepingStatus })),
    [operationalRooms],
  )

  const visibleRooms = useMemo(() => {
    const boardFiltered = filterHousekeepingBoardView(allOpenOperationalRooms, {
      status: null,
      building: buildingFilter,
      floor: floorFilter,
      assigneeId: null,
      cleanTypes: cleanTypeFilter,
      search: boardSearch,
      attention: null,
      unassignedOnly: false,
    }, nameById)
    const tabFiltered = filterAssignmentPoolByTab(boardFiltered, assignFilter, pendingAssignments)
    return sortAssignmentPool(tabFiltered)
  }, [allOpenOperationalRooms, buildingFilter, floorFilter, cleanTypeFilter, boardSearch, assignFilter, pendingAssignments, nameById])

  const unassignedSummary = useMemo(() => {
    const counts = getAssignmentPoolTabCounts(allOpenOperationalRooms, pendingAssignments)
    const credits = allOpenOperationalRooms
      .filter((room) => !pendingAssignments[room.roomId] && !room.assignedHousekeeperId)
      .reduce((sum, room) => sum + getRoomWorkloadCredits(room, creditWeights), 0)
    return { count: counts.unassigned, credits }
  }, [allOpenOperationalRooms, creditWeights, pendingAssignments])

  const stagedChangesList = useMemo(
    () => getStagedChangesList(openPoolRooms, pendingAssignments, nameById, t('housekeeping.assignWorkspace.row.unassigned')),
    [openPoolRooms, pendingAssignments, nameById, t],
  )
  const stagedCount = stagedChangesList.length

  const selectedCredits = useMemo(
    () => visibleRooms.filter((r) => selectedRoomIds.has(r.roomId)).reduce((sum, r) => sum + getRoomWorkloadCredits(r, creditWeights), 0),
    [visibleRooms, selectedRoomIds, creditWeights],
  )

  // -- Actions ----------------------------------------------------------------
  const handleOpenDetail = useCallback((room: HousekeepingOperationalRoom) => {
    const raw = allRooms.find((r: any) => r.room_id === room.roomId)
    if (raw) setSelectedRoom(raw)
  }, [allRooms])

  const handleChangeCleanType = useCallback((roomId: string, cleanType: CleanType) => {
    const ownerId = pendingAssignments[roomId] ?? allRooms.find((r: any) => r.room_id === roomId)?.assigned_to
    if (!ownerId) return
    setPendingAssignment(roomId, ownerId, cleanType)
  }, [allRooms, pendingAssignments, setPendingAssignment])

  const handleRemoveSavedAssignment = useCallback(async (assignmentId: string, roomId: string) => {
    const boardKey = ['housekeeping-board', selectedDate, selectedShift]
    const prev = queryClient.getQueryData(boardKey)
    queryClient.setQueryData(boardKey, (old: any) =>
      old?.data ? { ...old, data: old.data.map((r: any) => (r.room_id === roomId ? { ...r, assignment_id: null, assigned_to: null } : r)) } : old,
    )
    if (assignmentId.startsWith('optimistic-')) return
    try {
      await housekeepingApi.deleteAssignment(assignmentId)
      queryClient.invalidateQueries({ queryKey: boardKey })
    } catch {
      queryClient.setQueryData(boardKey, prev)
      toast.error(t('housekeeping.roomStatus.error.removeAssignmentFailed'))
    }
  }, [queryClient, selectedDate, selectedShift, t, toast])

  const handleRemoveMirroredAssignment = useCallback(async (roomId: string) => {
    const boardKey = ['housekeeping-board', selectedDate, selectedShift]
    const prev = queryClient.getQueryData(boardKey)
    queryClient.setQueryData(boardKey, (old: any) =>
      old?.data ? { ...old, data: old.data.map((r: any) => (r.room_id === roomId ? { ...r, assigned_to: null } : r)) } : old,
    )
    try {
      await housekeepingApi.removeRoomAssignmentMirror(roomId)
      queryClient.invalidateQueries({ queryKey: boardKey })
    } catch {
      queryClient.setQueryData(boardKey, prev)
      toast.error(t('housekeeping.roomStatus.error.removeAssignmentFailed'))
    }
  }, [queryClient, selectedDate, selectedShift, t, toast])

  const handleUnassign = useCallback((room: HousekeepingOperationalRoom) => {
    if (pendingAssignments[room.roomId]) {
      removePendingAssignment(room.roomId)
      return
    }
    const raw = allRooms.find((r: any) => r.room_id === room.roomId)
    if (raw?.assignment_id) handleRemoveSavedAssignment(raw.assignment_id, room.roomId)
    else if (room.assignedHousekeeperId) handleRemoveMirroredAssignment(room.roomId)
  }, [allRooms, handleRemoveMirroredAssignment, handleRemoveSavedAssignment, pendingAssignments, removePendingAssignment])

  const stageRoomToStaff = useCallback((roomId: string, staffId: string, cleanType?: CleanType) => {
    setPendingAssignment(roomId, staffId, cleanType)
  }, [setPendingAssignment])

  const handleAssignSelected = useCallback((staffId: string) => {
    let staged = 0
    let needsPrompt: { roomId: string; roomNumber: string } | null = null
    const skippedRoomIds: string[] = []

    for (const roomId of selectedRoomIds) {
      const raw = allRooms.find((r: any) => r.room_id === roomId)
      if (!raw) continue
      const operational = normalizeHousekeepingRoom(normalizeHousekeepingBoardRoom(raw))
      if (roomNeedsCleanTypePrompt(operational)) {
        if (!needsPrompt) needsPrompt = { roomId, roomNumber: operational.roomNumber }
        else skippedRoomIds.push(roomId)
        continue
      }
      stageRoomToStaff(roomId, staffId)
      staged += 1
    }

    if (staged > 0) {
      toast.success(t('housekeeping.assignWorkspace.toast.staged', { count: staged, name: (nameById[staffId] ?? '').split(' ')[0] }))
    }
    clearRoomSelection()
    if (needsPrompt) {
      setCleanTypePrompt({ ...needsPrompt, staffId })
      if (skippedRoomIds.length > 0) toast.info(t('housekeeping.assignWorkspace.toast.skippedNeedsCleanType', { count: skippedRoomIds.length }))
    }
  }, [allRooms, clearRoomSelection, nameById, selectedRoomIds, stageRoomToStaff, t, toast])

  const handleCleanTypePromptSelect = useCallback((cleanType: CleanType) => {
    if (!cleanTypePrompt) return
    stageRoomToStaff(cleanTypePrompt.roomId, cleanTypePrompt.staffId, cleanType)
    setCleanTypePrompt(null)
  }, [cleanTypePrompt, stageRoomToStaff])

  const handleDiscard = useCallback(() => {
    clearPendingAssignments()
  }, [clearPendingAssignments])

  const handlePublish = useCallback(() => {
    const entries = Object.entries(pendingAssignments).filter(([roomId, hkId]) => !!roomId && !!hkId)
    if (entries.length === 0) return

    const pendingSnapshot = { ...pendingAssignments }
    const cleanTypeSnapshot = { ...pendingAssignmentCleanTypes }
    const assignmentsPayload = entries.map(([roomId, housekeeperId]) => ({
      room_id: roomId,
      housekeeper_id: housekeeperId,
      ...(pendingAssignmentCleanTypes[roomId] ? { clean_type: pendingAssignmentCleanTypes[roomId] } : {}),
    }))

    const boardKey = ['housekeeping-board', selectedDate, selectedShift]
    const prevBoardData = queryClient.getQueryData(boardKey)
    queryClient.setQueryData(boardKey, (old: any) => {
      if (!old?.data) return old
      return {
        ...old,
        data: old.data.map((room: any) => {
          const housekeeperId = pendingSnapshot[room.room_id]
          if (!housekeeperId) return room
          return { ...room, assigned_to: housekeeperId, assignment_id: `optimistic-${room.room_id}` }
        }),
      }
    })

    clearPendingAssignments()
    setPublishing(true)

    housekeepingApi.saveAssignments({ date: selectedDate, shift_id: null, assignments: assignmentsPayload, is_ai_suggested: false })
      .then((result: any) => {
        const savedRows: any[] = result?.data ?? []
        const realIdByRoomId: Record<string, string> = {}
        savedRows.forEach((row: any) => { if (row?.room_id && row?.id) realIdByRoomId[row.room_id] = row.id })
        queryClient.setQueryData(boardKey, (old: any) => {
          if (!old?.data) return old
          return { ...old, data: old.data.map((room: any) => (realIdByRoomId[room.room_id] ? { ...room, assignment_id: realIdByRoomId[room.room_id] } : room)) }
        })
        toast.success(t('housekeeping.page.assignBar.saved'))
        queryClient.invalidateQueries({ queryKey: boardKey })
        queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
        queryClient.invalidateQueries({ queryKey: ['staff-list'] })
      })
      .catch((err: any) => {
        queryClient.setQueryData(boardKey, prevBoardData)
        Object.entries(pendingSnapshot).forEach(([roomId, housekeeperId]) => {
          setPendingAssignment(roomId, housekeeperId, cleanTypeSnapshot[roomId as keyof typeof cleanTypeSnapshot])
        })
        toast.error(err?.message || t('housekeeping.page.assignBar.saveError'))
      })
      .finally(() => setPublishing(false))
  }, [clearPendingAssignments, pendingAssignmentCleanTypes, pendingAssignments, queryClient, selectedDate, selectedShift, setPendingAssignment, t, toast])

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-ink3">{t('housekeeping.roomStatus.loading')}</div>
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm">
        <p className="text-ink3">{t('housekeeping.roomStatus.error.failedToLoad')}</p>
        <Button size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })}>
          {t('housekeeping.roomStatus.error.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] border border-[var(--accent-line)] bg-surface px-3.5 py-2.5 shadow-sm">
        <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          {t('housekeeping.assignWorkspace.header.eyebrow')}
        </span>
        <p className="text-[13px] text-ink2">
          {t('housekeeping.assignWorkspace.header.unassignedSummary', { count: unassignedSummary.count, credits: unassignedSummary.credits })}
        </p>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setShowAutoBalance(true)}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {t('housekeeping.assignWorkspace.header.autoBalance')}
        </Button>
        {stagedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowStagedChanges(true)}>
            {t('housekeeping.assignWorkspace.header.reviewChanges', { count: stagedCount })}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleDiscard} disabled={stagedCount === 0}>
          {t('housekeeping.assignWorkspace.header.discard')}
        </Button>
        <Button variant="primary" size="sm" onClick={handlePublish} disabled={stagedCount === 0 || publishing}>
          {publishing ? t('housekeeping.assignWorkspace.header.publishing') : t('housekeeping.assignWorkspace.header.publish', { count: stagedCount })}
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <AssignmentRoomPool
          allOpenRooms={allOpenOperationalRooms}
          visibleRooms={visibleRooms}
          nameById={nameById}
          onOpenDetail={handleOpenDetail}
          onChangeCleanType={handleChangeCleanType}
          onUnassign={handleUnassign}
        />
        <AssignmentTeamPanel
          loads={staffLoads}
          selectedCount={selectedRoomIds.size}
          selectedCredits={selectedCredits}
          onAssignSelected={handleAssignSelected}
        />
      </div>

      <RoomDetailDrawer room={selectedRoom} isOpen={selectedRoom !== null} onClose={() => setSelectedRoom(null)} />

      <AssignmentAutoBalance
        isOpen={showAutoBalance}
        onClose={() => setShowAutoBalance(false)}
        date={selectedDate}
        shiftId={selectedShift}
        currentRooms={openPoolRooms}
        nameById={nameById}
      />

      <StagedChangesPanel
        isOpen={showStagedChanges}
        onClose={() => setShowStagedChanges(false)}
        changes={stagedChangesList}
        onUndo={removePendingAssignment}
        onDiscardAll={() => { clearPendingAssignments(); setShowStagedChanges(false) }}
      />

      {cleanTypePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4" role="dialog" aria-modal="true" aria-labelledby="assign-workspace-clean-type-title">
          <div className="w-full max-w-sm rounded-[var(--r-lg)] border border-line bg-surface p-4 shadow-xl">
            <h2 id="assign-workspace-clean-type-title" className="text-sm font-semibold text-ink">
              {t('housekeeping.roomStatus.cleanTypePrompt.title', { roomNumber: cleanTypePrompt.roomNumber })}
            </h2>
            <p className="mt-1 text-xs text-ink3">{t('housekeeping.roomStatus.cleanTypePrompt.subtitle')}</p>
            <div className="mt-4 space-y-2">
              {CLEAN_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleCleanTypePromptSelect(option.value)}
                  className="w-full rounded-[var(--r-md)] border border-line bg-paper px-3 py-2 text-left transition-colors hover:border-amber-400 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <span className="block text-sm font-semibold text-ink">{option.label}</span>
                  <span className="block text-xs text-ink3">{option.hint}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setCleanTypePrompt(null)}>
              {t('housekeeping.roomStatus.cleanTypePrompt.cancelAria')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
