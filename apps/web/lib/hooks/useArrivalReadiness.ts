'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, differenceInMinutes } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { logbookApi } from '@/lib/api/logbook'
import { schedulingApi } from '@/lib/api/scheduling'

// The board endpoint (GET /housekeeping/board) returns `{ data: BoardRoom[] }` directly —
// there is no typed export for a board row elsewhere in the codebase, so it's declared here.
interface BoardRoom {
  room_id: string
  status: string
  clean_type: string | null
  assigned_to: string | null
  vip_flag: boolean
  updated_at: string
  notes: string | null
  rooms?: { room_number: string; floor: number | null; room_types?: { base_clean_minutes: number } }
}

export interface BlockerRow {
  id: string
  roomNumber: string
  title: string
  meta: string
  pillTone: 'alert' | 'caution' | 'blocked'
  pillLabel: string
  href: string
}

export interface ShiftTile {
  userId: string
  name: string
  done: number
  assigned: number
  behindPace: boolean
  area: string
}

export interface PaceProjection {
  readyByTime: string
  worstFloor: number
  worstFloorVipCount: number
  worstFloorDelayMinutes: number
}

export interface OvernightSummary {
  text: string
  href: string
}

function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function mostCommon(values: number[]): number | null {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | null = null
  let bestCount = 0
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v
      bestCount = count
    }
  }
  return best
}

export function useArrivalReadiness(hotelId: string) {
  const today = format(new Date(), 'yyyy-MM-dd')

  const boardQuery = useQuery({
    queryKey: ['housekeeping-board-gm-v3', today],
    queryFn: () => housekeepingApi.getBoard(today) as Promise<{ data: BoardRoom[] }>,
    enabled: !!hotelId,
    refetchInterval: 30_000,
  })

  const workOrdersQuery = useQuery({
    queryKey: ['gm-work-orders-v3'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  // Shared cache key with the legacy AI risk-alerts panel — same endpoint, reused per design handoff.
  const riskAlertsQuery = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  const rosterQuery = useQuery({
    queryKey: ['gm-today-roster'],
    queryFn: () => schedulingApi.todayRoster(),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  const logbookQuery = useQuery({
    queryKey: ['gm-overnight-summary', today],
    queryFn: () => logbookApi.listEntries({ entry_date: today, per_page: 20 }),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  const rooms = useMemo(() => boardQuery.data?.data ?? [], [boardQuery.data])
  const workOrders: WorkOrder[] = useMemo(() => workOrdersQuery.data?.data ?? [], [workOrdersQuery.data])
  const roster = useMemo(() => rosterQuery.data?.data?.roster ?? [], [rosterQuery.data])

  // No PMS-arrival signal is wired to the frontend for non-Opera-pilot hotels (opera_reservations
  // is write-only from the sync job). DEP clean_type rows — today's checkout/turnover rooms — are
  // the only hotel-agnostic proxy for "has an arrival today", and match how FrontDeskDashboard /
  // SupervisorDashboard already treat "ready for arrival" as a synonym for INSPECTED.
  const arrivalRooms = useMemo(() => rooms.filter((r) => r.clean_type === 'DEP'), [rooms])
  const arrivalRoomIds = useMemo(() => new Set(arrivalRooms.map((r) => r.room_id)), [arrivalRooms])

  const arrivalsCount = arrivalRooms.length
  const readyForArrivals = arrivalRooms.filter((r) => r.status === 'INSPECTED').length
  const awaitingInspection = arrivalRooms.filter((r) => r.status === 'CLEAN').length
  const beingCleaned = arrivalRooms.filter((r) => r.status === 'IN_PROGRESS').length
  const notStarted = arrivalRooms.filter((r) => r.status === 'DIRTY' || r.status === 'PICKUP').length
  const departureRoomsInPlay = awaitingInspection + beingCleaned + notStarted

  // Name lookup shared between work-order assignees and housekeeper tiles — sourced from today's
  // roster so no extra staff-list call is needed.
  const nameByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of roster) map.set(r.user_id, r.full_name)
    return map
  }, [roster])

  // React's purity rules forbid Date.now() during render (impure). The board query's own fetch
  // timestamp is a legitimate stand-in for "now" here — it updates every 30s (refetchInterval)
  // and is what "overdue" should be judged against anyway (data freshness, not render time).
  const now = boardQuery.dataUpdatedAt

  const blockers: BlockerRow[] = useMemo(() => {
    const rows: (BlockerRow & { sortWeight: number })[] = []

    // (a) open work orders on rooms with an arrival today
    for (const wo of workOrders) {
      if (!wo.room_id || !arrivalRoomIds.has(wo.room_id)) continue
      if (!['open', 'escalated', 'in_progress', 'on_hold'].includes(wo.status)) continue
      const isOverdue = !!wo.due_at && new Date(wo.due_at).getTime() < now
      const isUrgent = wo.priority === 'urgent' || wo.priority === 'emergency'
      const assignee = wo.assigned_to ? nameByUserId.get(wo.assigned_to) ?? 'Assigned' : 'Unassigned'
      rows.push({
        id: `wo-${wo.id}`,
        roomNumber: wo.rooms?.room_number ?? '—',
        title: `${wo.title} — WO-${wo.work_order_number}`,
        meta: `Engineering · ${assignee}`,
        pillTone: isOverdue || isUrgent ? 'alert' : 'caution',
        pillLabel: isOverdue ? 'Overdue' : isUrgent ? 'Urgent' : 'Open',
        href: `/engineering/work-orders?wo=${wo.id}`,
        sortWeight: isOverdue ? 0 : isUrgent ? 1 : 2,
      })
    }

    // (b) arrival rooms whose clean has exceeded the room type's expected duration
    for (const room of arrivalRooms) {
      if (room.status !== 'IN_PROGRESS') continue
      const expectedMinutes = room.rooms?.room_types?.base_clean_minutes ?? 30
      const elapsedMinutes = differenceInMinutes(new Date(now), new Date(room.updated_at))
      if (elapsedMinutes <= expectedMinutes) continue
      const assignee = room.assigned_to ? nameByUserId.get(room.assigned_to) ?? 'Assigned' : 'unassigned'
      rows.push({
        id: `overdue-${room.room_id}`,
        roomNumber: room.rooms?.room_number ?? '—',
        title: `Clean overdue since ${format(new Date(room.updated_at), 'h:mm a')}`,
        meta: `Housekeeping · ${assignee} · ${Math.round(elapsedMinutes / 60)}h on room`,
        pillTone: 'caution',
        pillLabel: 'Behind',
        href: `/housekeeping?room=${room.room_id}`,
        sortWeight: 3,
      })
    }

    // (c) OOO/OOS rooms — unconditional on arrival status, since an out-of-order room is never
    // sellable regardless of whether today's arrival math can be trusted for it.
    for (const room of rooms) {
      if (!['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.status)) continue
      rows.push({
        id: `ooo-${room.room_id}`,
        roomNumber: room.rooms?.room_number ?? '—',
        title: 'Out of order',
        meta: room.notes ? `Facilities · ${room.notes}` : 'Facilities · out of order',
        pillTone: 'blocked',
        pillLabel: 'OOO',
        href: `/housekeeping?room=${room.room_id}`,
        sortWeight: 4,
      })
    }

    return rows.sort((a, b) => a.sortWeight - b.sortWeight)
  }, [workOrders, arrivalRooms, arrivalRoomIds, rooms, nameByUserId, now])

  const shift = useMemo(() => {
    const onShift = roster.filter((r) => r.is_on_shift)
    const housekeepers = onShift.filter((r) => r.role === 'housekeeper')
    const others = onShift.filter((r) => r.role !== 'housekeeper')

    const tiles: ShiftTile[] = housekeepers.map((hk) => {
      const assignedRows = rooms.filter((r) => r.assigned_to === hk.user_id)
      const assigned = assignedRows.length
      const done = assignedRows.filter((r) => r.status === 'CLEAN' || r.status === 'INSPECTED').length
      const floors = assignedRows.map((r) => r.rooms?.floor).filter((f): f is number => f != null)
      const floor = mostCommon(floors)
      return {
        userId: hk.user_id,
        name: shortName(hk.full_name),
        done,
        assigned,
        behindPace: false,
        area: floor != null ? `floor ${floor}` : 'unassigned',
      }
    })

    // No absolute clock-based pace model exists for housekeeping today — "behind pace" is relative
    // to the team's median completion rate for the shift so far, not a fabricated minutes figure.
    const ratios = tiles.filter((t) => t.assigned > 0).map((t) => t.done / t.assigned)
    const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0
    for (const tile of tiles) {
      if (tile.assigned > 0) tile.behindPace = tile.done / tile.assigned < avgRatio - 0.15
    }

    return {
      tiles: tiles.slice(0, 6),
      behindCount: tiles.filter((t) => t.behindPace).length,
      totalOnShift: onShift.length,
      otherDeptCount: others.length,
    }
  }, [roster, rooms])

  const paceProjection: PaceProjection | null = useMemo(() => {
    const risks = riskAlertsQuery.data?.data?.housekeeping_risks ?? []
    if (risks.length === 0) return null

    const floorByRoomId = new Map<string, number>()
    const vipByRoomId = new Map<string, boolean>()
    for (const room of rooms) {
      if (room.rooms?.floor != null) floorByRoomId.set(room.room_id, room.rooms.floor)
      vipByRoomId.set(room.room_id, room.vip_flag)
    }

    const readyTimes = risks
      .map((r) => new Date(r.predicted_ready_at).getTime())
      .filter((t) => !Number.isNaN(t))
    if (readyTimes.length === 0) return null

    const maxReadyTime = Math.max(...readyTimes)
    const sortedTimes = [...readyTimes].sort((a, b) => a - b)
    const medianReadyTime = sortedTimes[Math.floor(sortedTimes.length / 2)]

    const byFloor = new Map<number, { highRiskCount: number; maxTime: number; vipCount: number }>()
    for (const risk of risks) {
      const floor = floorByRoomId.get(risk.room_id)
      if (floor == null) continue
      const time = new Date(risk.predicted_ready_at).getTime()
      if (Number.isNaN(time)) continue
      const entry = byFloor.get(floor) ?? { highRiskCount: 0, maxTime: 0, vipCount: 0 }
      if (risk.risk_level === 'HIGH') entry.highRiskCount += 1
      entry.maxTime = Math.max(entry.maxTime, time)
      if (vipByRoomId.get(risk.room_id)) entry.vipCount += 1
      byFloor.set(floor, entry)
    }
    if (byFloor.size === 0) return null

    const [worstFloor, worstEntry] = [...byFloor.entries()].sort(
      (a, b) => b[1].highRiskCount - a[1].highRiskCount || b[1].maxTime - a[1].maxTime
    )[0]

    return {
      readyByTime: format(new Date(maxReadyTime), 'h:mm a'),
      worstFloor,
      worstFloorVipCount: worstEntry.vipCount,
      worstFloorDelayMinutes: Math.max(0, Math.round((worstEntry.maxTime - medianReadyTime) / 60_000)),
    }
  }, [riskAlertsQuery.data, rooms])

  // The night-shift AI recap has no dedicated lookup — cron `logbook.shift-summary` runs 3x/day
  // (7, 15, 23 UTC), so the earliest AI-generated entry of the day is the one written for the
  // shift that just ended overnight.
  const overnightSummary: OvernightSummary | null = useMemo(() => {
    const entries = logbookQuery.data?.data ?? []
    const aiEntries = entries
      .filter((e) => e.is_ai_generated)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const entry = aiEntries[0]
    return entry ? { text: entry.content, href: '/logbook' } : null
  }, [logbookQuery.data])

  const lastUpdatedAt = useMemo(() => {
    const timestamps = [
      boardQuery.dataUpdatedAt,
      workOrdersQuery.dataUpdatedAt,
      riskAlertsQuery.dataUpdatedAt,
      rosterQuery.dataUpdatedAt,
      logbookQuery.dataUpdatedAt,
    ].filter((t) => t > 0)
    return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null
  }, [boardQuery.dataUpdatedAt, workOrdersQuery.dataUpdatedAt, riskAlertsQuery.dataUpdatedAt, rosterQuery.dataUpdatedAt, logbookQuery.dataUpdatedAt])

  return {
    lastUpdatedAt,
    hero: {
      arrivalsCount,
      readyForArrivals,
      awaitingInspection,
      beingCleaned,
      notStarted,
      departureRoomsInPlay,
      blockedCount: blockers.length,
      isLoading: boardQuery.isLoading,
      isError: boardQuery.isError,
      refetch: boardQuery.refetch,
    },
    pace: {
      projection: paceProjection,
      isLoading: riskAlertsQuery.isLoading,
      isError: riskAlertsQuery.isError,
    },
    blockers: {
      rows: blockers,
      totalCount: blockers.length,
      isLoading: boardQuery.isLoading || workOrdersQuery.isLoading,
      isError: boardQuery.isError || workOrdersQuery.isError,
      refetch: () => {
        boardQuery.refetch()
        workOrdersQuery.refetch()
      },
    },
    shift: {
      ...shift,
      isLoading: rosterQuery.isLoading || boardQuery.isLoading,
      isError: rosterQuery.isError || boardQuery.isError,
      refetch: () => {
        rosterQuery.refetch()
        boardQuery.refetch()
      },
    },
    overnight: {
      summary: overnightSummary,
      isLoading: logbookQuery.isLoading,
      isError: logbookQuery.isError,
      refetch: logbookQuery.refetch,
    },
  }
}
