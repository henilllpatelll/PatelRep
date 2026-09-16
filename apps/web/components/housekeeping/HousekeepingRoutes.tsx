'use client'

/**
 * Housekeeping · Routes — supervisor timeline board (real data).
 *
 * Visual language ported from the Claude Design "Housekeeping Routes" mock, but
 * every value is now driven by live hotel data:
 *   - lanes  = housekeeper-role staff (staffApi) with their board rooms
 *   - stops  = each housekeeper's rooms laid out as a *projected route*: done
 *              work sits left of the "now" line, remaining work extends right,
 *              sequenced by clean-type duration estimates (no per-room schedule
 *              exists in the data, so the timeline is a projection anchored to now)
 *   - pool / staged changes / publish = the real assign-mode machinery
 *     (housekeepingStore pending assignments + housekeepingApi.saveAssignments)
 *   - service requests + priority card = live guest requests (guestRequestsApi)
 *   - shift outlook = live readiness predictions
 *
 * The dashboard shell already renders the outer chrome (sidebar, header, Copilot
 * bubble), so this component renders only the page content.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { staffApi } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { getInitials, getDisplayName } from '@/lib/utils/avatar'
import { normalizeHousekeepingBoardRoom } from '@/lib/utils/housekeepingBoardFilters'
import { getCleanTypeCredits, getCleanTypeShortLabel, isOpenHousekeepingRoom, type CleanType } from '@/lib/utils/cleanType'

const MONO = 'var(--font-mono)'
const SERIF = 'var(--font-display)'

const PX = 3.6 // px per minute on the timeline (stretched so boxes read clearly)
const BOX_GAP = 6 // visual gap between back-to-back room boxes, in px
const TARGET = 16 // per-housekeeper credit target (matches RosterSidebar)

// Estimated clean minutes per type when the room type has no base_clean_minutes.
const DUR: Record<string, number> = { DEP: 45, FULL: 35, LIGHT: 25 }

// Per-clean-type styling (mirrors the design's alert/caution/info hues).
const CLEAN: Record<string, { tag: string; edge: string; tagBg: string; tagFg: string }> = {
  DEP: { tag: 'DEP', edge: '#a6263c', tagBg: '#f5d8de', tagFg: '#a6263c' },
  FULL: { tag: 'FULL', edge: '#a16207', tagBg: '#f5e9cf', tagFg: '#a16207' },
  LIGHT: { tag: 'LIGHT', edge: '#265d8a', tagBg: '#d8e6f0', tagFg: '#265d8a' },
}

// Neutral styling for rooms whose clean type isn't set yet (0 credits, honest label).
const CLEAN_UNKNOWN = { tag: 'STD', edge: '#a8a195', tagBg: '#f1ede4', tagFg: '#807a70' }

/** Visual treatment for a (possibly null) clean type — never fabricates a type. */
function cleanVisual(type?: string | null) {
  return (type && CLEAN[type]) || CLEAN_UNKNOWN
}

// Canonical room-status colours — matches the app's status tokens (globals.css)
// so a status reads the same here as it does on the Room Board.
const STATUS_STYLE: Record<string, { fg: string; bg: string; line: string }> = {
  DIRTY: { fg: '#a6263c', bg: '#f5d8de', line: '#e8a8b3' }, // alert
  OCCUPIED: { fg: '#a6263c', bg: '#f5d8de', line: '#e8a8b3' }, // alert
  PICKUP: { fg: '#a16207', bg: '#f5e9cf', line: '#e0c890' }, // caution
  IN_PROGRESS: { fg: '#7c3aed', bg: '#ede9fe', line: '#c4b5fd' }, // progress
  CLEAN: { fg: '#265d8a', bg: '#d8e6f0', line: '#a8c2d8' }, // info
  INSPECTED: { fg: '#0c6e63', bg: '#d6eae5', line: '#a4cfc7' }, // ready
  OOO: { fg: '#57534e', bg: '#f5f5f4', line: '#d6d3d1' }, // blocked
}
function statusVisual(status?: string | null) {
  return (status && STATUS_STYLE[status]) || STATUS_STYLE.DIRTY
}

// Stable avatar colour from the design palette, hashed off the name.
const AVATAR_PALETTE = ['#c2410c', '#0c6e63', '#a16207', '#265d8a', '#7d2855', '#4a2c8f']
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}

const CATEGORY_STYLE: Record<string, { fg: string; bg: string; line: string }> = {
  service: { fg: '#b8431c', bg: '#fbe9df', line: '#f0c8b3' },
  housekeeping: { fg: '#265d8a', bg: '#d8e6f0', line: '#a8c2d8' },
  maintenance: { fg: '#a16207', bg: '#f5e9cf', line: '#e0c890' },
  accessibility: { fg: '#4a2c8f', bg: '#ece4f8', line: '#c8b8e3' },
  other: { fg: '#6e685e', bg: '#f1ede4', line: '#e6dfd1' },
}

const OPEN_REQUEST_STATUSES = new Set([
  'open', 'acknowledged', 'dispatched', 'arrived', 'guest_contacted', 'reopened',
])

function roomNumberOf(room: any): string {
  return room.rooms?.room_number ?? room.room_number ?? '--'
}
function floorOf(room: any): number | null {
  return room.rooms?.floor ?? room.floor ?? null
}
// Buildings are physically separate (staff cross an outdoor courtyard to switch),
// so routes must exhaust one building before moving to the next.
function buildingOf(room: any): string {
  return room.rooms?.building ?? room.building ?? ''
}
function durationOf(room: any): number {
  return room.rooms?.room_types?.base_clean_minutes || DUR[room.clean_type] || 30
}
function isDone(room: any): boolean {
  return !isOpenHousekeepingRoom(room)
}

/** Minutes since midnight for a Date. */
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** Format a signed SLA countdown from a due-at ISO string. */
function slaTimer(dueAt?: string): { label: string; overdue: boolean } | null {
  if (!dueAt) return null
  const diffMs = new Date(dueAt).getTime() - Date.now()
  const overdue = diffMs < 0
  const mins = Math.round(Math.abs(diffMs) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const label = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  return { label: overdue ? `${label} over` : label, overdue }
}

export function HousekeepingRoutes() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { role, canAssignRooms } = useRole()

  const {
    rooms: rawRooms,
    setRooms,
    setPredictions,
    setLastSyncedAt,
    lastSyncedAt,
    predictions,
    selectedDate,
    selectedShift,
    assignmentMode,
    toggleAssignmentMode,
    activeAssigneeId,
    activeAssigneeName,
    setActiveAssignee,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    setPendingAssignment,
    removePendingAssignment,
    clearPendingAssignments,
  } = useHousekeepingStore()

  // Re-render every 30s so the "now" line advances and the sync label refreshes.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  // -- Data ------------------------------------------------------------------
  const { data: boardData, isLoading: boardLoading } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(selectedDate, selectedShift ?? undefined, true),
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (!boardData) return
    const rooms = (boardData as any)?.data ?? []
    setRooms(rooms)
    const preds = rooms
      .filter((r: any) => r.prediction != null)
      .map((r: any) => ({ ...r.prediction, room_id: r.room_id }))
    if (preds.length > 0) setPredictions(preds)
    setLastSyncedAt(new Date())
  }, [boardData, setRooms, setPredictions, setLastSyncedAt])

  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })

  const { data: guestRequestsData } = useQuery({
    queryKey: ['guest-requests-board'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const housekeepers: { id: string; name: string }[] = useMemo(
    () =>
      ((staffData as any)?.data?.staff ?? [])
        .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
        .map((s: any) => ({ id: s.user_id, name: getDisplayName(s.full_name) })),
    [staffData],
  )

  const staffNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const hk of housekeepers) map[hk.id] = hk.name
    return map
  }, [housekeepers])

  const rooms = useMemo(() => rawRooms.map((r: any) => normalizeHousekeepingBoardRoom(r)), [rawRooms])

  const ownerOf = (room: any): string | null => pendingAssignments[room.room_id] ?? room.assigned_to ?? null
  const cleanTypeOf = (room: any): CleanType | undefined =>
    (pendingAssignmentCleanTypes[room.room_id] ?? room.clean_type) as CleanType | undefined

  const now = minutesOfDay(new Date())

  // -- Route projection ------------------------------------------------------
  const board = useMemo(() => {
    const openRooms = rooms.filter(isOpenHousekeepingRoom)

    // Group each housekeeper's rooms and lay out a projected route.
    type Stop = { room: any; num: string; type: string | null; start: number; dur: number; state: 'done' | 'active' | 'pending' }
    const laneStops: Record<string, Stop[]> = {}
    for (const hk of housekeepers) laneStops[hk.id] = []

    for (const room of rooms) {
      const owner = ownerOf(room)
      if (!owner || !laneStops[owner]) continue
      const type = (cleanTypeOf(room) ?? null) as string | null
      const state: Stop['state'] = isDone(room) ? 'done' : room.status === 'IN_PROGRESS' ? 'active' : 'pending'
      laneStops[owner].push({ room, num: roomNumberOf(room), type, start: 0, dur: durationOf(room), state })
    }

    const stateRank = { done: 0, active: 1, pending: 2 }
    const laid: Record<string, Stop[]> = {}
    for (const hk of housekeepers) {
      const stops = laneStops[hk.id]
        .slice()
        .sort((a, b) => {
          if (stateRank[a.state] !== stateRank[b.state]) return stateRank[a.state] - stateRank[b.state]
          // Building groups first (no internal connection — crossing the courtyard
          // mid-route is expensive), then floor, then room number. Room numbers within
          // a floor already alternate across the corridor (e.g. 101/102, 103/104), so
          // ascending order is a single south-to-north (or entry-to-far-end) walk.
          const ba = buildingOf(a.room)
          const bb = buildingOf(b.room)
          if (ba !== bb) return ba.localeCompare(bb)
          const fa = floorOf(a.room) ?? 0
          const fb = floorOf(b.room) ?? 0
          if (fa !== fb) return fa - fb
          return a.num.localeCompare(b.num, undefined, { numeric: true })
        })
      const doneMinutes = stops.filter((s) => s.state === 'done').reduce((acc, s) => acc + s.dur, 0)
      let cursor = now - doneMinutes // done work ends at the now-line
      for (const s of stops) {
        s.start = cursor
        cursor += s.dur
      }
      laid[hk.id] = stops
    }

    // Shared day window across lanes so columns align.
    let minStart = now
    let maxEnd = now
    for (const hk of housekeepers) {
      for (const s of laid[hk.id]) {
        if (s.start < minStart) minStart = s.start
        if (s.start + s.dur > maxEnd) maxEnd = s.start + s.dur
      }
    }
    const winStart = Math.floor((Math.min(minStart, now) - 30) / 60) * 60
    const winEnd = Math.ceil((Math.max(maxEnd, now + 60)) / 60) * 60
    const span = Math.max(winEnd - winStart, 60)
    const laneWidth = Math.max(Math.round(span * PX), 760)
    const pos = (min: number) => `${Math.round((min - winStart) * PX)}px`

    const hours: { left: string; label: string }[] = []
    for (let m = winStart; m <= winEnd; m += 60) {
      const h = ((Math.floor(m / 60) % 24) + 24) % 24
      hours.push({ left: pos(m), label: h > 12 ? `${h - 12}p` : h === 12 ? '12p' : h === 0 ? '12a' : `${h}a` })
    }

    // Per-lane load + render values.
    const lanes = housekeepers
      .map((hk) => {
        const stops = laid[hk.id]
        const ownedOpen = openRooms.filter((r) => ownerOf(r) === hk.id)
        const savedCredits = ownedOpen
          .filter((r) => !pendingAssignments[r.room_id])
          .reduce((acc, r) => acc + getCleanTypeCredits(cleanTypeOf(r)), 0)
        const stagedCredits = ownedOpen
          .filter((r) => !!pendingAssignments[r.room_id])
          .reduce((acc, r) => acc + getCleanTypeCredits(cleanTypeOf(r)), 0)
        const credits = savedCredits + stagedCredits
        const over = credits - TARGET
        const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`
        const isSel = assignmentMode && activeAssigneeId === hk.id

        return {
          id: hk.id,
          name: hk.name,
          initials: getInitials(hk.name),
          hasWork: stops.length > 0 || credits > 0,
          rowBg: isSel ? '#fbe9df' : '#fff',
          avatarBg: avatarColor(hk.name),
          avatarRing: isSel ? '0 0 0 2px #b8431c' : 'none',
          loadText: `${ownedOpen.length} open · ${credits} cr`,
          delta: over > 2 ? `${over} over` : over < -2 ? `${Math.abs(over)} under` : 'on target',
          deltaBg: over > 2 ? '#f5e9cf' : over < -2 ? '#f1ede4' : '#d6eae5',
          deltaFg: over > 2 ? '#a16207' : over < -2 ? '#807a70' : '#0c6e63',
          deltaLine: over > 2 ? '#e0c890' : over < -2 ? '#e6dfd1' : '#a4cfc7',
          savedPct: pct((savedCredits / TARGET) * 100),
          stagedPct: pct((stagedCredits / TARGET) * 100),
          barFill: over > 2 ? '#a16207' : '#0c6e63',
          stops: stops.map((s) => {
            const c = cleanVisual(s.type) // clean-type label text only (DEP/FULL/LIGHT/STD)
            const st = statusVisual(s.room.status) // box colour follows room status
            const staged = !!pendingAssignments[s.room.room_id]
            const done = s.state === 'done'
            const active = s.state === 'active'
            const meta = done
              ? 'done'
              : active
                ? 'in progress'
                : staged
                  ? 'staged'
                  : ''
            return {
              key: s.room.room_id,
              num: s.num,
              tag: c.tag,
              meta,
              edge: done ? '#a8a195' : st.fg,
              left: pos(s.start),
              width: `${Math.max(Math.round(s.dur * PX) - BOX_GAP, 72)}px`,
              bg: done ? '#f1ede4' : staged ? '#fbe9df' : '#fff',
              border: staged ? '#f0c8b3' : active ? st.fg : '#e6dfd1',
              borderStyle: staged ? 'dashed' : 'solid',
              shadow: active ? '0 2px 6px rgba(26,24,21,.08)' : 'none',
              numFg: done ? '#807a70' : '#1a1815',
              tagBg: done ? '#e6dfd1' : st.bg,
              tagFg: done ? '#807a70' : st.fg,
              room: s.room,
            }
          }),
        }
      })

    const activeLanes = lanes.filter((l) => l.hasWork)
    const laneList = activeLanes.length > 0 ? activeLanes : lanes

    // Unassigned pool = open rooms with no owner (and not staged). Occupied rooms
    // with no clean type have no cleaning task defined, so they're excluded.
    const pool = openRooms
      .filter((r) => !ownerOf(r))
      .filter((r) => !(r.status === 'OCCUPIED' && !r.clean_type))
      .sort((a, b) => {
        const ba = buildingOf(a)
        const bb = buildingOf(b)
        if (ba !== bb) return ba.localeCompare(bb)
        const fa = floorOf(a) ?? 0
        const fb = floorOf(b) ?? 0
        if (fa !== fb) return fa - fb
        return roomNumberOf(a).localeCompare(roomNumberOf(b), undefined, { numeric: true })
      })
      .map((r) => {
        const sc = statusVisual(r.status)
        // Room number only — except stayover pickups, which also show FULL / LIGHT.
        const pickupType = r.status === 'PICKUP' ? getCleanTypeShortLabel(r.clean_type) : null
        return {
          key: r.room_id,
          num: roomNumberOf(r),
          meta: pickupType,
          edge: sc.fg, // status colour, shown as a left edge bar (like the lane boxes)
          // Assign mode → stage the room; otherwise open the room drawer.
          onClick: () => (assignmentMode ? stageRoom(r) : setSelectedRoom(r)),
        }
      })

    // Pills / outlook.
    const readyCount = rooms.filter((r) => r.status === 'INSPECTED').length
    const vacantDirty = rooms.filter((r) => r.status === 'DIRTY').length
    const atRisk = rooms.filter((r) => {
      const p = predictions[r.room_id] ?? r.prediction
      return p?.risk_level === 'HIGH' || p?.risk_level === 'MEDIUM'
    }).length
    const remainingOpen = openRooms.length

    return {
      lanes: laneList,
      onShiftCount: laneList.length,
      hours,
      nowLeft: pos(now),
      laneWidth,
      pool,
      readyCount,
      vacantDirty,
      remainingOpen,
      atRisk,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, housekeepers, pendingAssignments, pendingAssignmentCleanTypes, assignmentMode, activeAssigneeId, predictions, now])

  // -- Guest requests (service requests + priority card) ---------------------
  const requests: GuestRequest[] = useMemo(() => {
    const all: GuestRequest[] = (guestRequestsData as any)?.data ?? []
    return all
      .filter((r) => OPEN_REQUEST_STATUSES.has(r.status))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity
        return da - db
      })
  }, [guestRequestsData])

  const priorityRequest = requests.find((r) => r.id !== dismissedRequestId) ?? null

  // -- Assign-mode actions ---------------------------------------------------
  function stageRoom(room: any) {
    if (!assignmentMode) {
      toast.info('Turn on assign mode first')
      return
    }
    if (!activeAssigneeId) {
      toast.info('Select a housekeeper lane first')
      return
    }
    setPendingAssignment(room.room_id, activeAssigneeId, (room.clean_type ?? undefined) as CleanType | undefined)
  }

  const stagedEntries = Object.entries(pendingAssignments).filter(([r, h]) => !!r && !!h)

  const stagedItems = useMemo(
    () =>
      stagedEntries.map(([roomId, hkId]) => {
        const room = rooms.find((r: any) => r.room_id === roomId)
        return {
          roomId,
          num: room ? roomNumberOf(room) : roomId.slice(0, 4),
          move: `Unassigned → ${staffNameById[hkId]?.split(' ')[0] ?? 'staff'}`,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingAssignments, rooms, staffNameById],
  )

  function handlePublish() {
    if (stagedEntries.length === 0) return
    const payload = stagedEntries.map(([room_id, housekeeper_id]) => ({
      room_id,
      housekeeper_id,
      ...(pendingAssignmentCleanTypes[room_id] ? { clean_type: pendingAssignmentCleanTypes[room_id] } : {}),
    }))
    const assignMap = new Map(payload.map((p) => [p.room_id, p]))
    const boardQueryKey = ['housekeeping-board', selectedDate, selectedShift]
    const snapshot = { ...pendingAssignments }
    const cleanSnapshot = { ...pendingAssignmentCleanTypes }
    const previousBoardData = queryClient.getQueryData(boardQueryKey)

    // Patch the board cache immediately so assigned rooms move into their
    // lane the instant Publish is clicked, instead of waiting on the
    // save + refetch round trip.
    queryClient.setQueryData(boardQueryKey, (old: any) => {
      if (!old) return old
      const data = (old.data ?? []).map((room: any) => {
        const assignment = assignMap.get(room.room_id)
        if (!assignment) return room
        return {
          ...room,
          assigned_to: assignment.housekeeper_id,
          ...(assignment.clean_type ? { clean_type: assignment.clean_type } : {}),
        }
      })
      return { ...old, data }
    })
    clearPendingAssignments()

    housekeepingApi
      .saveAssignments({ date: selectedDate, shift_id: null, assignments: payload, is_ai_suggested: false })
      .then(() => {
        toast.success(
          payload.length === 1 ? '1 room assigned' : `${payload.length} rooms assigned`,
        )
        queryClient.invalidateQueries({ queryKey: boardQueryKey })
        queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
        queryClient.invalidateQueries({ queryKey: ['staff-list'] })
      })
      .catch((err: any) => {
        queryClient.setQueryData(boardQueryKey, previousBoardData)
        Object.entries(snapshot).forEach(([roomId, hkId]) =>
          setPendingAssignment(roomId, hkId, cleanSnapshot[roomId as keyof typeof cleanSnapshot]),
        )
        toast.error(err?.message || 'Could not publish assignments')
      })
  }

  // -- Access gate -----------------------------------------------------------
  if (role && role !== 'gm' && role !== 'housekeeping_supervisor') {
    return (
      <div className="flex items-center justify-center h-64">
        <EmptyState title="Routes is available to supervisors and managers." />
      </div>
    )
  }

  const syncLabel = lastSyncedAt
    ? (() => {
        const diff = Math.floor((new Date().getTime() - lastSyncedAt.getTime()) / 60000)
        return diff < 1 ? 'just now' : diff === 1 ? '1 min ago' : `${diff} min ago`
      })()
    : 'syncing…'

  const assignActive = assignmentMode && canAssignRooms
  const poolHint = !canAssignRooms
    ? 'Rooms waiting for a housekeeper'
    : !assignmentMode
      ? 'Turn on assign mode to place these'
      : activeAssigneeName
        ? `${activeAssigneeName.split(' ')[0]} is selected — click a room to add it`
        : 'Select a housekeeper lane, then click a room'

  return (
    <div>
      <style>{'@keyframes pulseDot{0%,100%{opacity:1}50%{opacity:.35}}'}</style>

      {/* Title block */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#807a70', marginBottom: 8 }}>
            {t('housekeeping.routes.eyebrow', { date: format(new Date(), 'EEEE d') })}
          </div>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontWeight: 400, fontSize: 34, lineHeight: 1.1, letterSpacing: '-0.5px', color: '#1a1815' }}>
            {t('housekeeping.routes.title')}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            <Pill bg="#d6eae5" fg="#0c6e63" line="#a4cfc7">{t('housekeeping.routes.readyPill', { n: board.readyCount })}</Pill>
            <Pill bg="#f5d8de" fg="#a6263c" line="#e8a8b3">{t('housekeeping.routes.vacantDirtyPill', { n: board.vacantDirty })}</Pill>
            <Pill bg="#fbe9df" fg="#b8431c" line="#f0c8b3">{t('housekeeping.routes.serviceRequestsPill', { n: requests.length })}</Pill>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#0c6e63' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#0c6e63', animation: 'pulseDot 2s ease-in-out infinite' }} />
              {t('housekeeping.routes.liveSynced', { time: syncLabel })}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
          <HeaderButton onClick={() => router.push('/tasks?view=guest')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
            </svg>
            {t('housekeeping.routes.logGuestCall')}
          </HeaderButton>
          <HeaderButton onClick={() => router.push('/housekeeping')} bg="transparent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
            {t('housekeeping.routes.gridView')}
          </HeaderButton>
          {canAssignRooms && (
            <button
              onClick={toggleAssignmentMode}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: assignmentMode ? '#1a1815' : '#fff',
                color: assignmentMode ? '#f7f4ee' : '#1a1815',
                border: `1px solid ${assignmentMode ? '#1a1815' : '#e6dfd1'}`,
                padding: '7px 12px', fontSize: 13, height: 34, borderRadius: 8, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {assignmentMode ? t('housekeeping.routes.assignModeOn') : t('housekeeping.routes.assignMode')}
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 336px', gap: 20, paddingTop: 18, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ background: '#fff', border: '1px solid #e6dfd1', borderRadius: 14, boxShadow: '0 1px 2px rgba(26,24,21,.04)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 186 + board.laneWidth }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: `186px ${board.laneWidth}px`, borderBottom: '1px solid #efe9dc', background: '#fbf9f4' }}>
                  <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', color: '#807a70', textTransform: 'uppercase', position: 'sticky', left: 0, background: '#fbf9f4', zIndex: 2, borderRight: '1px solid #efe9dc' }}>
                    {t('housekeeping.routes.onShift', { n: board.onShiftCount })}
                  </div>
                  <div style={{ position: 'relative', height: 36 }}>
                    {board.hours.map((h, i) => (
                      <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: h.left, borderLeft: '1px solid #efe9dc', paddingLeft: 7, display: 'flex', alignItems: 'center', fontFamily: MONO, fontSize: 11, color: '#a8a195' }}>
                        {h.label}
                      </div>
                    ))}
                    <div style={{ position: 'absolute', top: 0, bottom: -2, left: board.nowLeft, borderLeft: '1.5px solid #b8431c', display: 'flex', alignItems: 'center', zIndex: 1 }}>
                      <span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 10, fontWeight: 600, color: '#b8431c', background: '#fbe9df', border: '1px solid #f0c8b3', borderRadius: 5, padding: '1px 5px' }}>
                        {format(new Date(), 'h:mm')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lanes */}
                {boardLoading && board.lanes.length === 0 ? (
                  <div style={{ padding: '28px 16px', fontSize: 13, color: '#807a70' }}>{t('housekeeping.routes.loading')}</div>
                ) : board.lanes.length === 0 ? (
                  <div style={{ padding: '28px 16px', fontSize: 13, color: '#807a70' }}>
                    {t('housekeeping.routes.noHousekeepers')}
                  </div>
                ) : (
                  board.lanes.map((l) => (
                    <div
                      key={l.id}
                      onClick={() => assignActive && setActiveAssignee(activeAssigneeId === l.id ? null : l.id, activeAssigneeId === l.id ? null : l.name)}
                      style={{ display: 'grid', gridTemplateColumns: `186px ${board.laneWidth}px`, borderBottom: '1px solid #efe9dc', background: l.rowBg, cursor: assignActive ? 'pointer' : 'default' }}
                    >
                      <div style={{ padding: '13px 14px', borderRight: '1px solid #efe9dc', position: 'sticky', left: 0, background: l.rowBg, zIndex: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 28, height: 28, borderRadius: 999, background: l.avatarBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, letterSpacing: '.3px', flexShrink: 0, boxShadow: l.avatarRing }}>
                            {l.initials}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1815' }}>
                            {l.name}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: '#4a4640' }}>{l.loadText}</span>
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 10, fontWeight: 500, border: `1px solid ${l.deltaLine}`, background: l.deltaBg, color: l.deltaFg, borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                            {l.delta}
                          </span>
                        </div>
                        <div style={{ position: 'relative', height: 5, borderRadius: 3, background: '#f1ede4', marginTop: 8, overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: l.savedPct, background: l.barFill }} />
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: l.savedPct, width: l.stagedPct, background: 'repeating-linear-gradient(135deg,#b8431c 0 3px,rgba(184,67,28,.4) 3px 6px)' }} />
                        </div>
                      </div>

                      <div style={{ position: 'relative', height: 82 }}>
                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: board.nowLeft, borderLeft: '1px solid #f0c8b3' }} />
                        {l.stops.length === 0 ? (
                          <div style={{ position: 'absolute', top: 30, left: 14, fontSize: 11, color: '#a8a195', fontFamily: MONO }}>{t('housekeeping.routes.noRooms')}</div>
                        ) : (
                          l.stops.map((s) => (
                            <div
                              key={s.key}
                              onClick={(e) => { e.stopPropagation(); setSelectedRoom(s.room) }}
                              style={{ position: 'absolute', top: 13, height: 56, left: s.left, width: s.width, border: `1px ${s.borderStyle} ${s.border}`, borderRadius: 10, background: s.bg, boxShadow: s.shadow, padding: '8px 9px 8px 11px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden', cursor: 'pointer' }}
                            >
                              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: s.edge }} />
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: s.numFg }}>{s.num}</span>
                                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.5px', color: s.tagFg, background: s.tagBg, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{s.tag}</span>
                              </div>
                              {s.meta && <div style={{ fontFamily: MONO, fontSize: 10, color: '#807a70', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.meta}</div>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Unassigned pool */}
          <div style={{ background: '#fff', border: '1px dashed #e6dfd1', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', color: '#807a70', textTransform: 'uppercase' }}>{t('housekeeping.routes.unassigned')}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: '#a8a195' }}>{t('housekeeping.routes.roomsCount', { n: board.pool.length })}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: assignActive ? '#b8431c' : '#807a70' }}>{poolHint}</span>
            </div>
            {board.pool.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#807a70', margin: 0 }}>{t('housekeeping.routes.poolEmpty')}</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {board.pool.map((p) => (
                  <button
                    key={p.key}
                    onClick={p.onClick}
                    style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #e6dfd1', background: '#fff', borderRadius: 10, padding: '7px 11px 7px 13px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                  >
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: p.edge }} />
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: '#1a1815' }}>{p.num}</span>
                    {p.meta && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase', color: '#807a70' }}>{p.meta}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 }}>
          {priorityRequest && (
            <div style={{ border: '1px solid #c8b8e3', background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 30px rgba(26,24,21,.08)' }}>
              <div style={{ background: '#ece4f8', padding: '13px 15px', borderBottom: '1px solid #c8b8e3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: '#4a2c8f', border: '1px solid #c8b8e3', fontSize: 10, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4 }}>
                    {priorityRequest.priority === 'urgent' ? t('housekeeping.routes.urgent') : t('housekeeping.routes.priority')}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1px', color: '#4a2c8f', textTransform: 'uppercase' }}>
                    {priorityRequest.rooms?.room_number
                      ? t('housekeeping.routes.guestRequestRoom', { room: priorityRequest.rooms.room_number })
                      : t('housekeeping.routes.guestRequest')}
                  </span>
                </div>
                <p style={{ margin: '9px 0 0', fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, lineHeight: 1.4, color: '#1a1815' }}>
                  {priorityRequest.title}
                </p>
              </div>
              <div style={{ padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <MetaChip>{priorityRequest.category}</MetaChip>
                  {(() => { const s = slaTimer(priorityRequest.due_at); return s ? <MetaChip alert={s.overdue}>SLA {s.label}</MetaChip> : null })()}
                  {priorityRequest.guest_name ? <MetaChip>{priorityRequest.guest_name}</MetaChip> : null}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => router.push('/tasks?view=guest')}
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid #b8431c', background: '#b8431c', color: '#fff', borderRadius: 8, height: 34, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {t('housekeeping.routes.openRequest')}
                  </button>
                  <button
                    onClick={() => setDismissedRequestId(priorityRequest.id)}
                    style={{ border: '1px solid #e6dfd1', background: '#fff', color: '#1a1815', borderRadius: 8, height: 34, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {t('housekeeping.routes.dismiss')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Service requests */}
          <div style={{ background: '#fff', border: '1px solid #e6dfd1', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(26,24,21,.04)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 16px 10px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', color: '#807a70', textTransform: 'uppercase' }}>{t('housekeeping.routes.serviceRequests')}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#a8a195', fontFamily: MONO }}>{t('housekeeping.routes.openCount', { n: requests.length })}</span>
            </div>
            {requests.length === 0 ? (
              <div style={{ padding: '4px 16px 16px', fontSize: 12.5, color: '#807a70' }}>{t('housekeeping.routes.noRequests')}</div>
            ) : (
              requests.slice(0, 5).map((r) => {
                const c = CATEGORY_STYLE[r.category] ?? CATEGORY_STYLE.other
                const s = slaTimer(r.due_at)
                const owner = r.assigned_to ? staffNameById[r.assigned_to] ?? 'Assigned' : 'Unassigned'
                return (
                  <div
                    key={r.id}
                    onClick={() => router.push(`/tasks?view=guest&focus=${r.id}`)}
                    style={{ padding: '11px 16px', borderTop: '1px solid #efe9dc', display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: '#1a1815' }}>
                        {r.rooms?.room_number ? r.rooms.room_number : `#${r.request_number}`}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 500, color: c.fg, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 999, padding: '2px 7px', lineHeight: '14px' }}>{r.category}</span>
                      <span style={{ flex: 1 }} />
                      {s && <span style={{ fontFamily: MONO, fontSize: 11, color: s.overdue ? '#a6263c' : '#807a70' }}>{s.label}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#807a70', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontSize: 11.5, color: '#4a4640' }}>{owner}</div>
                  </div>
                )
              })
            )}
          </div>

          {/* Staged changes */}
          {canAssignRooms && (
            <div style={{ background: '#fff', border: `1px solid ${stagedItems.length ? '#f0c8b3' : '#e6dfd1'}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(26,24,21,.04)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '14px 16px 10px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', color: '#807a70', textTransform: 'uppercase' }}>{t('housekeeping.routes.stagedChanges')}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: '#b8431c', fontFamily: MONO }}>{t('housekeeping.routes.pendingCount', { n: stagedItems.length })}</span>
              </div>
              {stagedItems.length === 0 ? (
                <div style={{ padding: '4px 16px 16px', fontSize: 12.5, color: '#807a70' }}>
                  {assignmentMode ? t('housekeeping.routes.stageHintOn') : t('housekeeping.routes.stageHintOff')}
                </div>
              ) : (
                <>
                  {stagedItems.map((s) => (
                    <div key={s.roomId} style={{ padding: '10px 16px', borderTop: '1px solid #efe9dc', display: 'flex', alignItems: 'baseline', gap: 9 }}>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: '#1a1815' }}>{s.num}</span>
                      <span style={{ flex: 1, fontSize: 11.5, color: '#4a4640', lineHeight: 1.45 }}>{s.move}</span>
                      <button onClick={() => removePendingAssignment(s.roomId)} style={{ border: 'none', background: 'transparent', color: '#807a70', fontSize: 11.5, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>{t('housekeeping.routes.undo')}</button>
                    </div>
                  ))}
                  <div style={{ padding: '12px 16px', borderTop: '1px solid #efe9dc', display: 'flex', gap: 8, background: '#fbf9f4' }}>
                    <button onClick={handlePublish} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid #b8431c', background: '#b8431c', color: '#fff', borderRadius: 8, height: 34, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{t('housekeeping.routes.publish')}</button>
                    <button onClick={() => clearPendingAssignments()} style={{ border: '1px solid #e6dfd1', background: '#fff', color: '#1a1815', borderRadius: 8, height: 34, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{t('housekeeping.routes.discard')}</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Shift outlook */}
          <div style={{ background: '#1a1815', color: '#f7f4ee', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', opacity: 0.6 }}>{t('housekeeping.routes.shiftOutlook')}</div>
            <p style={{ margin: '8px 0 0', fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, lineHeight: 1.4 }}>
              {board.remainingOpen === 0
                ? 'Every room is clean and inspected — the floor is caught up.'
                : board.atRisk > 0
                  ? `${board.remainingOpen} room${board.remainingOpen === 1 ? '' : 's'} still open, and ${board.atRisk} at risk of missing check-in. Watch the lanes running over target.`
                  : `${board.remainingOpen} room${board.remainingOpen === 1 ? '' : 's'} still open, all on pace for check-in.`}
            </p>
          </div>
        </aside>
      </div>

      <RoomDetailDrawer
        room={selectedRoom}
        isOpen={selectedRoom !== null}
        onClose={() => setSelectedRoom(null)}
      />
    </div>
  )
}

// -- Small presentational helpers --------------------------------------------

function Pill({ children, bg, fg, line }: { children: React.ReactNode; bg: string; fg: string; line: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color: fg, border: `1px solid ${line}`, fontWeight: 500, padding: '3px 9px', fontSize: 11.5, lineHeight: '16px', borderRadius: 999 }}>
      <span style={{ fontFamily: MONO }}>{children}</span>
    </span>
  )
}

function HeaderButton({ children, onClick, bg = '#fff' }: { children: React.ReactNode; onClick: () => void; bg?: string }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: bg, color: '#1a1815', border: '1px solid #e6dfd1', padding: '7px 12px', fontSize: 13, height: 34, borderRadius: 8, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {children}
    </button>
  )
}

function MetaChip({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, border: `1px solid ${alert ? '#e8a8b3' : '#e6dfd1'}`, background: alert ? '#f5d8de' : '#fbf9f4', borderRadius: 6, padding: '3px 7px', color: alert ? '#a6263c' : '#4a4640', textTransform: 'capitalize' }}>
      {children}
    </span>
  )
}
