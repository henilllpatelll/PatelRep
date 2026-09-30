'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, AlertTriangle, MessageSquare, Wrench, BedDouble, ChevronRight, CircleAlert, Clock3, ListTodo, UserRound } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi } from '@/lib/api/engineering'
import { roomsApi } from '@/lib/api/rooms'
import { notificationsApi } from '@/lib/api/notifications'
import { staffApi } from '@/lib/api/staff'
import { programsApi } from '@/lib/api/programs'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { useRole } from '@/lib/hooks/useRole'
import { getCleanTypeLabel, getCleanTypeCredits, isOpenHousekeepingRoom, CLEAN_TYPE_OPTIONS, type CleanType } from '@/lib/utils/cleanType'
import { getRoomTypeCode } from '@/lib/utils/roomType'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { getRoomDetailAssignmentDate, getRoomDetailPresentation } from '@/lib/housekeeping/roomDetailView'
import { normalizeHousekeepingRoom, getDndWelfareStatus } from '@/lib/housekeeping/roomState'
import { RoomPrioritySheet } from './RoomPrioritySheet'
import { InspectionDrawer } from './InspectionDrawer'
import { ServiceAttemptForm } from './ServiceAttemptForm'
import { RoomServiceStatusSheet } from './RoomServiceStatusSheet'
import { OccupancyDiscrepancySheet } from './OccupancyDiscrepancySheet'

const WO_CATEGORIES = [
  { value: 'appliance' },
  { value: 'electrical' },
  { value: 'furniture' },
  { value: 'general' },
  { value: 'hvac' },
  { value: 'plumbing' },
  { value: 'safety' },
  { value: 'structural' },
] as const

interface Props {
  room: any | null
  isOpen: boolean
  onClose: () => void
  selectedDate: string
  onCheckoutTimeSaved?: (checkoutTime: string) => void
}

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'

function formatHistoryTimestamp(isoString: string, t: TFunction): string {
  try {
    const date = new Date(isoString)
    const timeStr = format(date, 'h:mm a')
    if (isToday(date)) return timeStr
    if (isYesterday(date)) return t('housekeeping.roomDetail.history.yesterdayTime', { time: timeStr })
    return `${format(date, 'MMM d')} ${timeStr}`
  } catch {
    return isoString
  }
}

function formatCheckinTime(isoString: string | null | undefined): string | null {
  if (!isoString) return null
  try {
    return format(new Date(isoString), 'h:mm a')
  } catch {
    return null
  }
}

function formatTimeInput(isoString: string | null | undefined): string {
  if (!isoString) return ''
  try {
    return format(new Date(isoString), 'HH:mm')
  } catch {
    return ''
  }
}

const LATE_CHECKOUT_CHIPS = ['12:00 PM', '1:00 PM', '2:00 PM', '4:00 PM'] as const

/** Standard hotel checkout. Departure rooms with no explicit checkout_time set
 * fall back to this in the drawer's departure row; staff can still push it later
 * via the Change departure sheet. Display-only — nothing is persisted until the
 * sheet writes a real time. */
const DEFAULT_CHECKOUT_TIME = '11:00 AM'

/** "2:00 PM" -> "14:00", for feeding buildCheckoutTimeIso the same 24h format the raw time input uses. */
function chipLabelTo24h(label: string): string {
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(label.trim())
  if (!m) return ''
  let hours = parseInt(m[1], 10)
  const minutes = m[2]
  const meridiem = m[3].toUpperCase()
  if (meridiem === 'PM' && hours !== 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${minutes}`
}

function buildCheckoutTimeIso(timeValue: string, existingIso?: string | null): string | undefined {
  if (!timeValue) return undefined
  const [hours, minutes] = timeValue.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined
  const date = existingIso ? new Date(existingIso) : new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function buildingOf(room: any): string {
  return room?.rooms?.building ?? room?.building ?? ''
}
function floorOf(room: any): number | null {
  return room?.rooms?.floor ?? room?.floor ?? null
}

interface HousekeeperOption {
  id: string
  name: string
  openCount: number
  credits: number
  building: string | null
  score: number
}

/**
 * Ranks housekeepers for a mid-stay clean request by how well the room fits
 * their current route: staying in the same building they're already working
 * (no courtyard crossing) beats an idle housekeeper, which beats pulling
 * someone off a different building. Floor distance and current workload
 * (credits) break ties within the same tier. Mirrors the building-first sort
 * Team Plan uses for its own room sequencing (lib/housekeeping/teamPlanView.ts).
 */
function rankHousekeepers(
  housekeepers: { id: string; name: string }[],
  openRooms: any[],
  targetBuilding: string,
  targetFloor: number | null,
): HousekeeperOption[] {
  return housekeepers
    .map((hk) => {
      const ownRooms = openRooms.filter((r) => (r.assigned_to ?? null) === hk.id)
      const credits = ownRooms.reduce((acc, r) => acc + getCleanTypeCredits(r.clean_type), 0)
      const sameBuildingRooms = targetBuilding ? ownRooms.filter((r) => buildingOf(r) === targetBuilding) : []
      const otherBuildingRooms = ownRooms.filter((r) => buildingOf(r) && buildingOf(r) !== targetBuilding)
      const buildingMatch = sameBuildingRooms.length > 0
      const floorDistance = buildingMatch
        ? Math.min(...sameBuildingRooms.map((r) => Math.abs((floorOf(r) ?? 0) - (targetFloor ?? 0))))
        : 0
      // Tiers: already in this building (0/500) < idle (500) < working the other building (1000).
      const tierScore = buildingMatch ? floorDistance * 10 : otherBuildingRooms.length > 0 ? 1000 : 500
      return {
        id: hk.id,
        name: hk.name,
        openCount: ownRooms.length,
        credits,
        building: buildingMatch ? targetBuilding : otherBuildingRooms.length > 0 ? buildingOf(otherBuildingRooms[0]) : null,
        score: tierScore + credits,
      }
    })
    .sort((a, b) => a.score - b.score)
}

function getActionLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'IN_PROGRESS': return t('housekeeping.roomDetail.actionLabels.started')
    case 'CLEAN': return t('housekeeping.roomDetail.actionLabels.markedClean')
    case 'INSPECTED': return t('housekeeping.roomDetail.actionLabels.markedReady')
    case 'DIRTY': return t('housekeeping.roomDetail.actionLabels.returnedToCleaning')
    case 'OOO':
    case 'OUT_OF_ORDER':
    case 'OUT_OF_SERVICE': return t('housekeeping.roomDetail.actionLabels.markedOutOfOrder')
    case 'PICKUP': return t('housekeeping.roomDetail.actionLabels.markedPickup')
    default: return t('housekeeping.roomDetail.actionLabels.updated')
  }
}

/** A note-only history row (from_status === to_status, e.g. add_room_note or a
 * Phase 8 event like Rush set/DND attempt/discrepancy reported) has nothing to
 * do with the status it happens to be logged against -- show the real note
 * instead of mislabeling it as a status change (e.g. "Marked ready"). */
function getActivityLine(entry: any, t: TFunction): string {
  const isNoteOnly = Boolean(entry.notes) && entry.from_status === entry.to_status
  return isNoteOnly ? entry.notes : getActionLabel(entry.to_status, t)
}

function getLastUpdateAt(room: any | null): string | null {
  return room?.updated_at ?? room?.last_cleaned_at ?? room?.last_inspected_at ?? null
}

/** Caps at 12h: a room stuck IN_PROGRESS longer than that means updated_at is
 * stale (abandoned session, clock skew, seed data), not a genuinely long clean —
 * showing that raw number would mislead housekeeping rather than inform it. */
function getElapsedMinutes(startIso: string | null): number | null {
  if (!startIso) return null
  const minutes = Math.round((Date.now() - new Date(startIso).getTime()) / 60000)
  if (minutes < 0 || minutes > 720) return null
  return minutes
}

type Occupancy = 'DEPARTURE' | 'OCCUPIED' | 'VACANT'

/** Departure is a `clean_type` flag, not a `status` — a departing room can be
 * DIRTY/IN_PROGRESS/CLEAN/INSPECTED depending on turn progress. PICKUP means a
 * stayover clean is queued while the guest is still in the room, so it counts
 * as occupied too — Vacant must only ever mean nobody is in the room. Mirrors
 * classifyOccupancy() in SimplifiedDashboard.tsx. */
function getOccupancy(room: any | null): Occupancy {
  if (room?.clean_type === 'DEP') return 'DEPARTURE'
  if (room?.status === 'OCCUPIED' || room?.status === 'PICKUP') return 'OCCUPIED'
  return 'VACANT'
}

/** Static so Tailwind's JIT can find the literal class names — the varName
 * from getHeaderTone can't be interpolated directly into a `bg-[var(--x)]`
 * class and still be picked up by the build-time content scan. */
const HEADER_BAR_TONE: Record<string, string> = {
  progress: 'bg-[var(--progress)]',
  blocked: 'bg-[var(--blocked)]',
  caution: 'bg-[var(--caution)]',
  alert: 'bg-[var(--alert)]',
  ready: 'bg-[var(--ready)]',
  info: 'bg-[var(--info)]',
}

/** Header tone reuses the hash-frozen room-status CSS vars (see
 * frozen-files.json room_status_values) — never a new color for these meanings. */
function getHeaderTone(status: string, occupancy: Occupancy): { varName: string; eyebrowKey: string; striped: boolean } {
  if (status === 'IN_PROGRESS') return { varName: 'progress', eyebrowKey: 'cleaningInProgress', striped: false }
  if (status === 'OOO' || status === 'OUT_OF_ORDER' || status === 'OUT_OF_SERVICE') return { varName: 'blocked', eyebrowKey: 'outOfOrder', striped: false }
  // Checked before the OCCUPIED branch below: Pickup is occupied too (see
  // getOccupancy), but it has its own more specific header with the clean
  // type baked in, so it must win over the generic "Stayover" label.
  if (status === 'PICKUP') return { varName: 'caution', eyebrowKey: 'pickup', striped: false }
  if (occupancy === 'OCCUPIED') return { varName: 'alert', eyebrowKey: 'occupiedStayover', striped: true }
  if (occupancy === 'DEPARTURE') {
    // A departure room's guest is still in-house exactly when the effective
    // status is OCCUPIED (see getEffectiveRoomStatusForCleanType in
    // cleanType.ts) — everything else means they've already checked out.
    return status === 'OCCUPIED'
      ? { varName: 'alert', eyebrowKey: 'occupiedDeparture', striped: true }
      : { varName: 'alert', eyebrowKey: 'vacantDeparture', striped: false }
  }
  if (status === 'INSPECTED') return { varName: 'ready', eyebrowKey: 'vacantReady', striped: false }
  if (status === 'CLEAN') return { varName: 'info', eyebrowKey: 'cleanAwaitingInspection', striped: false }
  return { varName: 'alert', eyebrowKey: 'vacantDirty', striped: false }
}

export function RoomDetailDrawer({ room, isOpen, onClose, selectedDate, onCheckoutTimeSaved }: Props) {
  const { t } = useTranslation()
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const queryClient = useQueryClient()
  const toast = useToast()
  const drawerRef = useRef<HTMLDivElement>(null)
  const workOrderSheetRef = useRef<HTMLDivElement>(null)
  const messageSheetRef = useRef<HTMLDivElement>(null)
  const departureSheetRef = useRef<HTMLDivElement>(null)
  const assignmentSheetRef = useRef<HTMLDivElement>(null)

  const [advanceLoading, setAdvanceLoading] = useState(false)
  const [msgOpen, setMsgOpen] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [msgLoading, setMsgLoading] = useState(false)

  const [checkoutTimeInput, setCheckoutTimeInput] = useState('')
  const [saveTimeLoading, setSaveTimeLoading] = useState(false)
  const [stayoverLoading, setStayoverLoading] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [lateChoice, setLateChoice] = useState<string>('2:00 PM')
  const [customTimeMode, setCustomTimeMode] = useState(false)

  const [woOpen, setWoOpen] = useState(false)
  const [woTitle, setWoTitle] = useState('')
  const [woCategory, setWoCategory] = useState('')
  const [woDescription, setWoDescription] = useState('')
  const [woPriority, setWoPriority] = useState<'urgent' | 'normal' | 'low'>('normal')
  const [woLoading, setWoLoading] = useState(false)
  const [woError, setWoError] = useState<string | null>(null)

  const [assignSheetOpen, setAssignSheetOpen] = useState(false)
  const [assignCleanType, setAssignCleanType] = useState<CleanType>('LIGHT')
  const [assignHousekeeperId, setAssignHousekeeperId] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)

  // Phase 8: Rush/priority, DND attempts, service declined, occupancy discrepancy
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [attemptOpen, setAttemptOpen] = useState(false)
  const [declinedOpen, setDeclinedOpen] = useState(false)
  const [discrepancyOpen, setDiscrepancyOpen] = useState(false)
  const [dndClearLoading, setDndClearLoading] = useState(false)

  const roomId: string | null = room?.room_id ?? null
  const status: RoomStatus = (room?.status ?? 'DIRTY') as RoomStatus

  useEffect(() => {
    setCheckoutTimeInput(formatTimeInput(room?.checkout_time))
    setSheetOpen(false)
    setLateChoice('2:00 PM')
    setCustomTimeMode(false)
    setMsgOpen(false)
    setMsgText('')
    setWoOpen(false)
    setWoTitle('')
    setWoCategory('')
    setAssignSheetOpen(false)
    setAssignCleanType(room?.clean_type ?? 'LIGHT')
    setAssignHousekeeperId(null)
    setWoDescription('')
    setWoPriority('normal')
    setWoError(null)
    setPriorityOpen(false)
    setAttemptOpen(false)
    setDeclinedOpen(false)
    setDiscrepancyOpen(false)
  }, [roomId, isOpen, room?.checkout_time, room?.clean_type])

  async function handleCreateWorkOrder() {
    if (!woTitle.trim() || !woCategory || !roomId) return
    setWoLoading(true)
    setWoError(null)
    try {
      await engineeringApi.createWorkOrder({
        title: woTitle.trim(),
        category: woCategory,
        description: woDescription.trim() || undefined,
        priority: woPriority,
        room_id: room?.room_id,
      })
      setWoTitle('')
      setWoDescription('')
      setWoCategory('')
      setWoPriority('normal')
      setWoOpen(false)
      const roomLabel = room?.rooms?.room_number ?? room?.room_number ?? roomId
      toast.success(t('housekeeping.roomDetail.workOrderForm.successMessage', { room: roomLabel }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    } catch {
      setWoError(t('housekeeping.roomDetail.workOrderForm.error'))
    } finally {
      setWoLoading(false)
    }
  }

  async function handleSaveCheckoutTime(explicitTime?: string) {
    const timeValue = explicitTime ?? checkoutTimeInput
    if (!roomId || !timeValue) return
    const timeIso = buildCheckoutTimeIso(timeValue, room?.checkout_time)
    if (!timeIso) return
    setSaveTimeLoading(true)
    try {
      await housekeepingApi.updateCheckoutTime(roomId, timeIso)
      setSheetOpen(false)
      toast.success(t('housekeeping.roomDetail.changeDeparture.confirm', { time: customTimeMode ? checkoutTimeInput : lateChoice }))
      onCheckoutTimeSaved?.(timeIso)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    } catch {
      toast.error(t('housekeeping.roomDetail.departureCheckout.saveError'))
    } finally {
      setSaveTimeLoading(false)
    }
  }

  async function handleMarkStayover() {
    if (!roomId) return
    setStayoverLoading(true)
    try {
      await roomsApi.markStayover(roomId)
      setSheetOpen(false)
      toast.success(t('housekeeping.roomDetail.departureCheckout.stayoverSuccess'))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch {
      toast.error(t('housekeeping.roomDetail.departureCheckout.stayoverError'))
    } finally {
      setStayoverLoading(false)
    }
  }

  async function handleAdvanceStatus(targetStatus: string, successMsg: string) {
    if (!roomId) return
    setAdvanceLoading(true)
    try {
      await roomsApi.updateStatus(roomId, targetStatus)
      toast.success(successMsg)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch {
      toast.error(t('housekeeping.roomDetail.advanceError'))
    } finally {
      setAdvanceLoading(false)
    }
  }

  async function handleSendMessage() {
    const recipientId: string | null = room?.assigned_to ?? null
    if (!recipientId || !msgText.trim()) return
    setMsgLoading(true)
    try {
      await notificationsApi.sendDirect(recipientId, msgText.trim())
      toast.success(t('housekeeping.roomDetail.primary.messageSent', { name: assignedName ?? '' }))
      setMsgOpen(false)
      setMsgText('')
    } catch {
      toast.error(t('housekeeping.roomDetail.primary.messageError'))
    } finally {
      setMsgLoading(false)
    }
  }

  const prediction = room?.prediction ?? null

  const { data: lastActionData } = useQuery({
    queryKey: ['room-history-last-action', roomId],
    queryFn: () => housekeepingApi.getRoomHistory(roomId!, 5),
    enabled: !!roomId && isOpen,
    staleTime: 15_000,
  })

  const roomWorkOrdersQuery = useQuery({
    queryKey: ['room-detail-work-orders', roomId],
    queryFn: () => engineeringApi.listWorkOrders({ room_id: roomId!, per_page: 10 }),
    enabled: !!roomId && isOpen,
    staleTime: 30_000,
  })
  const roomGuestRequestsQuery = useQuery({
    queryKey: ['room-detail-guest-requests', roomId],
    queryFn: () => guestRequestsApi.listRequests({ room_id: roomId!, per_page: 10 }),
    enabled: !!roomId && isOpen,
    staleTime: 30_000,
  })
  const roomTasksQuery = useQuery({
    queryKey: ['room-detail-tasks', roomId],
    queryFn: () => tasksApi.list({ room_id: roomId!, per_page: 10 }),
    enabled: !!roomId && isOpen,
    staleTime: 30_000,
  })

  // The board never inlines the assigned housekeeper's name (only their
  // assigned_to UUID), so resolve it here from the shared staff roster — cached
  // under the same key the boards already use, so this adds no extra request.
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    staleTime: 5 * 60_000,
    enabled: isOpen,
  })

  const canAssignClean = (canSupervise || role === 'front_desk') && status === 'OCCUPIED' && !!roomId

  // The open board for this workspace's operational date, used only to rank
  // housekeepers by route fit when the assign-clean sheet is open.
  const assignmentSuggestionDate = getRoomDetailAssignmentDate(selectedDate)
  const { data: assignBoardData } = useQuery({
    queryKey: ['housekeeping-board-for-assign-suggestion', assignmentSuggestionDate],
    queryFn: () => housekeepingApi.getBoard(assignmentSuggestionDate, undefined, false),
    enabled: assignSheetOpen,
    staleTime: 15_000,
  })

  useModalFocusTrap(drawerRef, isOpen, onClose)
  useModalFocusTrap(workOrderSheetRef, woOpen, () => setWoOpen(false))
  useModalFocusTrap(messageSheetRef, msgOpen, () => setMsgOpen(false))
  useModalFocusTrap(departureSheetRef, sheetOpen, () => setSheetOpen(false))
  useModalFocusTrap(assignmentSheetRef, assignSheetOpen, () => setAssignSheetOpen(false))

  // Phase 8: Rush/priority, DND attempts, service declined, occupancy discrepancy
  const operationalRoom = normalizeHousekeepingRoom(room)
  // Mirrors deriveRoomAttentionItems()'s isRushPriority in roomState.ts -- Rush
  // is a manual override on the priority column, distinct from predicted risk.
  const isRush = operationalRoom.priority !== null && operationalRoom.priority <= 2
  const canManageRush = canSupervise || role === 'front_desk'
  const canReportException = isHousekeeper || canSupervise
  const canResolveDiscrepancy = role === 'front_desk' || canSupervise

  const roomServiceAttemptsQuery = useQuery({
    queryKey: ['room-service-attempts', roomId],
    queryFn: () => housekeepingApi.getServiceAttempts(roomId!, 5),
    enabled: !!roomId && isOpen && (operationalRoom.dnd || operationalRoom.dndAttemptCount > 0),
    staleTime: 15_000,
  })
  const roomDiscrepanciesQuery = useQuery({
    queryKey: ['room-discrepancies', roomId],
    queryFn: () => housekeepingApi.getRoomDiscrepancies(roomId!),
    enabled: !!roomId && isOpen,
    staleTime: 15_000,
  })
  // Programs' dnd-welfare-policy read is gm/housekeeping_supervisor/engineer-only
  // server-side (PROGRAM_MANAGER_ROLES) -- only fetch it for roles that can read it.
  const dndWelfarePolicyQuery = useQuery({
    queryKey: ['programs-overview-for-welfare'],
    queryFn: () => programsApi.overview(),
    enabled: isOpen && canSupervise && operationalRoom.dnd,
    staleTime: 60_000,
  })

  const serviceAttempts = roomServiceAttemptsQuery.data?.data ?? []
  const openDiscrepancy = (roomDiscrepanciesQuery.data?.data ?? []).find((d) => d.status === 'open') ?? null
  const dndPolicy = dndWelfarePolicyQuery.data?.data?.dnd_welfare_policy
  const welfareStatus = getDndWelfareStatus(
    operationalRoom,
    dndPolicy ? { thresholdHours: dndPolicy.threshold_hours } : null,
  )

  async function handleQuickDndCleared() {
    if (!roomId) return
    setDndClearLoading(true)
    try {
      await housekeepingApi.recordServiceAttempt(roomId, { result: 'dnd_cleared' })
      toast.success(t('housekeeping.roomDetail.dnd.clearedToast', { roomNumber }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-service-attempts', roomId] })
    } catch {
      toast.error(t('housekeeping.roomDetail.dnd.clearError'))
    } finally {
      setDndClearLoading(false)
    }
  }

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? '—'
  const roomTypeName = getRoomTypeCode(room) ?? ''
  const floor = room?.rooms?.floor ?? room?.floor ?? '—'
  const vipFlag = !!room?.vip_flag
  const cleanTypeLabel = getCleanTypeLabel(room?.clean_type)
  // Pickup only ever means a stayover clean (Full/Light) is queued, but the
  // header eyebrow otherwise just says "Pickup" with no way to tell which —
  // surface it right in the header instead of burying it under a guest row
  // that may not even be present.
  const staffList: any[] = (staffData as any)?.data?.staff ?? []
  const assignedName: string | null =
    room?.user_profiles?.preferred_name ??
    room?.user_profiles?.full_name ??
    (room?.assigned_to ? staffList.find((s) => s.user_id === room.assigned_to)?.full_name ?? null : null)

  const housekeeperRoster = staffList
    .filter((s) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
    .map((s) => ({ id: s.user_id as string, name: s.full_name as string }))
  const assignBoardRooms: any[] = ((assignBoardData as any)?.data ?? []).filter(isOpenHousekeepingRoom)
  const housekeeperOptions = rankHousekeepers(housekeeperRoster, assignBoardRooms, buildingOf(room), floorOf(room))

  // Default to the top-ranked housekeeper once the board query has actually
  // resolved — before that, every housekeeper looks "idle" (no board data to
  // rank against yet), so locking in that placeholder order would default to
  // whichever roster row happens to sort first, not the real suggestion.
  useEffect(() => {
    if (assignSheetOpen && !assignHousekeeperId && assignBoardData && housekeeperOptions.length > 0) {
      setAssignHousekeeperId(housekeeperOptions[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignSheetOpen, housekeeperOptions, assignBoardData])

  async function handleAssignRoomClean() {
    if (!roomId || !assignHousekeeperId) return
    setAssignLoading(true)
    try {
      await housekeepingApi.saveAssignments({
        date: format(new Date(), 'yyyy-MM-dd'),
        shift_id: null,
        assignments: [{ room_id: roomId, housekeeper_id: assignHousekeeperId, clean_type: assignCleanType }],
        is_ai_suggested: false,
      })
      setAssignSheetOpen(false)
      const hkName = housekeeperOptions.find((h) => h.id === assignHousekeeperId)?.name ?? ''
      toast.success(t('housekeeping.roomDetail.assignClean.successToast', { roomNumber, name: hkName }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board-for-assign-suggestion'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch (err: any) {
      toast.error(err?.message || t('housekeeping.roomDetail.assignClean.error'))
    } finally {
      setAssignLoading(false)
    }
  }

  const checkinTime = formatCheckinTime(prediction?.checkin_time ?? room?.checkin_time)
  const scheduledCheckoutTime = formatCheckinTime(room?.checkout_time)
  const lateCheckoutTime: string | null =
    room?.late_checkout_requested_time ?? room?.late_checkout_request?.requested_time ?? null
  const canMarkCheckout = (canSupervise || role === 'front_desk') && !!roomId
  const isCheckedOut = !!room?.actual_checkout_at || (room?.fo_status === 'VAC' && room?.clean_type === 'DEP')
  const canMarkStayover = canMarkCheckout && !isCheckedOut && room?.clean_type === 'DEP' && room?.fo_status === 'OCC'
  const etaTime = formatCheckinTime(prediction?.predicted_ready_at)

  const detail = getRoomDetailPresentation(room, {
    canSupervise,
    canAssignOccupiedClean: canAssignClean,
  })
  const roomWorkOrders: any[] = (roomWorkOrdersQuery.data as any)?.data ?? []
  const roomGuestRequests: GuestRequest[] = roomGuestRequestsQuery.data?.data ?? []
  const roomTasks: Task[] = (roomTasksQuery.data as any)?.data ?? []
  const activity = (lastActionData?.data ?? []).slice(0, 4)

  const occupancy = getOccupancy(room)
  const headerTone = getHeaderTone(status, occupancy)
  const isCleaningNow = status === 'IN_PROGRESS'
  const cleaningStartedIso = getLastUpdateAt(room)
  const startedAtLabel = isCleaningNow ? formatCheckinTime(cleaningStartedIso) : null
  const elapsedMinutes: number | null = isCleaningNow ? getElapsedMinutes(cleaningStartedIso) : null

  const showDepartureRow = occupancy === 'DEPARTURE' || occupancy === 'OCCUPIED'
  const departureRowLabel = occupancy === 'DEPARTURE'
    ? t('housekeeping.roomDetail.changeDeparture.checkoutRowLabel')
    : t('housekeeping.roomDetail.changeDeparture.departureRowLabel')
  const departureRowValue = lateCheckoutTime
    ? t('housekeeping.roomDetail.changeDeparture.lateValue', { time: lateCheckoutTime })
    : occupancy === 'DEPARTURE'
      ? (scheduledCheckoutTime ?? DEFAULT_CHECKOUT_TIME)
      : t('housekeeping.roomDetail.changeDeparture.tomorrow')

  // Primary drawer action — advances the room forward one real step. Every
  // branch is either a real status transition (roomsApi.updateStatus, which
  // the API validates server-side per role) or, where the room genuinely has
  // nowhere further to go (already ready/vacant), an honest no-op toast.
  const primaryAction: { label: string; run: () => void } | null = (() => {
    if (detail.primaryAction === 'completeCleaning') {
      return {
        label: t('housekeeping.roomDetail.workspace.completeCleaning'),
        run: () => handleAdvanceStatus('CLEAN', t('housekeeping.roomDetail.primary.queuedToast', { roomNumber })),
      }
    }
    // Required sampled inspections open the checklist drawer; only non-sampled
    // rooms retain the quick Mark Ready path below.
    if (detail.primaryAction === 'markReady') {
      return {
        label: t('housekeeping.roomDetail.primary.markInspected'),
        run: () => handleAdvanceStatus('INSPECTED', t('housekeeping.roomDetail.primary.inspectedToast', { roomNumber })),
      }
    }
    if (detail.primaryAction === 'assign') {
      return {
        label: t('housekeeping.roomDetail.primary.assignToClean'),
        run: () => setAssignSheetOpen(true),
      }
    }
    if (detail.primaryAction === 'startCleaning') {
      return {
        label: t('housekeeping.roomDetail.primary.startClean'),
        run: () => handleAdvanceStatus('IN_PROGRESS', t('housekeeping.roomDetail.primary.startedToast', { roomNumber, name: assignedName })),
      }
    }
    if (detail.primaryAction === 'requestCleaning') {
      return {
        label: t('housekeeping.roomDetail.primary.requestClean'),
        run: () => handleAdvanceStatus('IN_PROGRESS', t('housekeeping.roomDetail.primary.requestedToast', { roomNumber })),
      }
    }
    if (detail.primaryAction === 'returnToCleaning') {
      return {
        label: t('housekeeping.roomDetail.workspace.returnToCleaning'),
        run: () => handleAdvanceStatus('DIRTY', t('housekeeping.roomDetail.primary.returnedToast', { roomNumber })),
      }
    }
    return null
  })()

  if (!isOpen) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/30 backdrop-blur-sm z-drawer transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('housekeeping.roomDetail.roomDetailsAria', { roomNumber })}
        className="fixed right-0 top-0 z-drawer flex h-full w-[34rem] max-w-full flex-col border-l border-line bg-surface shadow-2xl outline-none"
      >
        <span
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-2.5 ${headerTone.striped ? '' : HEADER_BAR_TONE[headerTone.varName] ?? 'bg-[var(--alert)]'}`}
          style={headerTone.striped ? { backgroundImage: 'repeating-linear-gradient(135deg, var(--alert) 0 4px, rgba(255,255,255,0.55) 4px 8px)' } : undefined}
          aria-hidden="true"
        />
        <header className="shrink-0 border-b border-line bg-surface px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink3">{t(`housekeeping.roomDetail.header.eyebrow.${headerTone.eyebrowKey}`)}</p>
              <h2 className="mt-1 font-mono text-5xl font-semibold leading-none tracking-[-0.06em] tabular-nums text-ink">{roomNumber}</h2>
              <p className="mt-2 text-sm text-ink2">{roomTypeName ? t('housekeeping.roomDetail.header.floorAndType', { floor, type: roomTypeName }) : t('housekeeping.roomDetail.header.floorOnly', { floor })}</p>
            </div>
            <Button variant="ghost" onClick={onClose} className="min-h-10 min-w-10 rounded-[var(--r-md)] p-0" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4" /></Button>
          </div>
          {(detail.contextKey || vipFlag || detail.statusKey === 'outOfOrder') && <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
            {detail.contextKey && <span className="rounded-[var(--r-sm)] bg-surface-2 px-2 py-1 text-ink2">{t(`housekeeping.roomCard.context.${detail.contextKey}`)}</span>}
            {vipFlag && <span className="rounded-[var(--r-sm)] bg-[var(--caution-soft)] px-2 py-1 text-[var(--caution)]">{t('housekeeping.roomCard.vip')}</span>}
          </div>}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 py-6">
          <section aria-labelledby="room-current-status">
            <p id="room-current-status" className="flex items-center gap-2 text-lg font-semibold text-ink"><span className={`h-2.5 w-2.5 rounded-full ${detail.statusKey === 'ready' ? 'bg-[var(--ready)]' : detail.statusKey === 'outOfOrder' ? 'bg-[var(--blocked)]' : detail.statusKey === 'cleaning' ? 'bg-[var(--progress)]' : 'bg-[var(--alert)]'}`} aria-hidden="true" />{t(`housekeeping.roomCard.status.${detail.statusKey}`)}</p>
            {cleanTypeLabel && <p className="mt-1 text-sm text-ink2">{cleanTypeLabel}</p>}
            {detail.statusKey === 'outOfOrder' && <Link href={`/housekeeping/out-of-order?room=${roomId}`} className="mt-2 inline-flex text-sm font-medium text-accent underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-accent">{t('housekeeping.roomDetail.actionLabels.openOutOfOrderRecord')}</Link>}
            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-y border-line py-4 text-sm sm:grid-cols-2">
              {detail.factKeys.includes('arrival') && checkinTime && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.arrival')}</dt><dd className="font-mono text-right tabular-nums text-ink">{checkinTime}</dd></>}
              {detail.factKeys.includes('checkout') && showDepartureRow && <><dt className="text-ink3">{departureRowLabel}</dt><dd className="font-mono text-right tabular-nums text-ink">{departureRowValue}</dd></>}
              {detail.factKeys.includes('assigned') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.assigned')}</dt><dd className="text-right font-medium text-ink">{assignedName ?? t('housekeeping.roomDetail.workspace.unassigned')}</dd></>}
              {detail.factKeys.includes('started') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.started')}</dt><dd className="font-mono text-right tabular-nums text-ink">{startedAtLabel ?? '—'}</dd></>}
              {detail.factKeys.includes('elapsed') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.elapsed')}</dt><dd className="font-mono text-right tabular-nums text-ink">{elapsedMinutes != null ? t('housekeeping.roomDetail.workspace.minutes', { minutes: elapsedMinutes }) : '—'}</dd></>}
              {detail.factKeys.includes('cleanedBy') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.cleanedBy')}</dt><dd className="text-right font-medium text-ink">{assignedName ?? '—'}</dd></>}
              {detail.factKeys.includes('completed') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.completed')}</dt><dd className="font-mono text-right tabular-nums text-ink">{formatCheckinTime(room?.last_cleaned_at) ?? '—'}</dd></>}
              {detail.factKeys.includes('inspection') && <><dt className="text-ink3">{t('housekeeping.roomDetail.workspace.inspection')}</dt><dd className="text-right font-medium text-ink">{detail.statusKey === 'ready' ? t('housekeeping.roomDetail.workspace.passed') : t('housekeeping.roomDetail.workspace.required')}</dd></>}
            </dl>
          </section>

          {!isHousekeeper && detail.showArrivalRisk && <section className="rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-4" aria-labelledby="room-arrival-risk">
            <p id="room-arrival-risk" className="flex items-center gap-2 text-sm font-semibold text-[var(--alert)]"><CircleAlert className="h-4 w-4" aria-hidden="true" />{t('housekeeping.roomDetail.workspace.arrivalRisk')}</p>
            <p className="mt-3 text-sm text-ink">{etaTime ? t('housekeeping.roomDetail.workspace.predictedReady', { time: etaTime }) : t('housekeeping.roomDetail.workspace.arrivalAtRisk')}</p>
            {checkinTime && <p className="mt-1 text-xs text-ink2">{t('housekeeping.roomDetail.workspace.guestArrival', { time: checkinTime })}</p>}
            {detail.riskFactorKeys.length > 0 && <ul className="mt-3 space-y-1 text-sm text-ink2">{detail.riskFactorKeys.map((factor) => <li key={factor}>• {t(`housekeeping.roomDetail.workspace.riskFactors.${factor}`)}</li>)}</ul>}
          </section>}

          {isRush && <section className="rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-4" aria-labelledby="room-priority">
            <div className="flex items-center justify-between gap-3">
              <p id="room-priority" className="flex items-center gap-2 text-sm font-semibold text-[var(--alert)]"><span className="h-2 w-2 rounded-full bg-[var(--alert)]" aria-hidden="true" />{t('housekeeping.roomDetail.priority.activeLabel')}</p>
              {canManageRush && <Button variant="outline" size="sm" onClick={() => setPriorityOpen(true)}>{t('housekeeping.roomDetail.priority.editAction')}</Button>}
            </div>
            <div className="mt-2 space-y-1 text-sm text-ink">
              {operationalRoom.priorityReason && <p>{t(`housekeeping.roomDetail.priority.reason.${operationalRoom.priorityReason}`)}</p>}
              {operationalRoom.priorityNeededBy && <p className="text-ink2">{t('housekeeping.roomDetail.priority.neededByValue', { time: formatCheckinTime(operationalRoom.priorityNeededBy) })}</p>}
              {operationalRoom.priorityNote && <p className="text-ink3">{operationalRoom.priorityNote}</p>}
            </div>
          </section>}

          {operationalRoom.dnd && <section className="rounded-[var(--r-lg)] border border-line bg-surface-2 p-4" aria-labelledby="room-dnd">
            <p id="room-dnd" className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="h-2 w-2 rounded-full bg-[var(--ink-3)]" aria-hidden="true" />{t('housekeeping.roomDetail.dnd.activeLabel')}</p>
            <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-ink3">{t('housekeeping.roomDetail.dnd.attempts')}</dt><dd className="text-right font-mono tabular-nums text-ink">{operationalRoom.dndAttemptCount}</dd>
              {operationalRoom.dndLastAttemptAt && <><dt className="text-ink3">{t('housekeeping.roomDetail.dnd.lastAttempt')}</dt><dd className="text-right font-mono tabular-nums text-ink">{formatCheckinTime(operationalRoom.dndLastAttemptAt)}</dd></>}
              {operationalRoom.dndRetryAt && <><dt className="text-ink3">{t('housekeeping.roomDetail.dnd.nextAttempt')}</dt><dd className="text-right font-mono tabular-nums text-ink">{formatCheckinTime(operationalRoom.dndRetryAt)}</dd></>}
              {welfareStatus && <>
                <dt className="text-ink3">{t('housekeeping.roomDetail.dnd.welfareEscalation')}</dt>
                <dd className={`text-right font-mono tabular-nums ${welfareStatus.overdue ? 'text-[var(--alert)]' : 'text-ink'}`}>{formatCheckinTime(welfareStatus.escalatesAt.toISOString())}</dd>
                <dt className="text-ink3">{t('housekeeping.roomDetail.dnd.remaining')}</dt>
                <dd className={`text-right font-mono tabular-nums ${welfareStatus.overdue ? 'text-[var(--alert)]' : 'text-ink'}`}>{welfareStatus.overdue ? t('housekeeping.roomDetail.dnd.overdue') : t('housekeeping.roomDetail.dnd.remainingValue', { minutes: welfareStatus.remainingMinutes })}</dd>
              </>}
            </dl>
            {serviceAttempts.length > 0 && <div className="mt-3 space-y-2 border-t border-line pt-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink3">{t('housekeeping.roomDetail.dnd.attemptsHeading')}</p>
              {serviceAttempts.slice(0, 3).map((attempt) => <div key={attempt.id} className="text-sm"><p className="font-mono tabular-nums text-ink">{formatCheckinTime(attempt.attempted_at)}</p><p className="text-ink2">{t(`housekeeping.roomDetail.attempt.result.${attempt.result}`)}</p></div>)}
            </div>}
            {canReportException && <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              <Button variant="outline" size="sm" onClick={() => setAttemptOpen(true)}>{t('housekeeping.roomDetail.attempt.trigger')}</Button>
              {!operationalRoom.serviceDeclined && <Button variant="outline" size="sm" onClick={() => setDeclinedOpen(true)}>{t('housekeeping.roomDetail.serviceDeclined.trigger')}</Button>}
              <Button variant="outline" size="sm" loading={dndClearLoading} onClick={handleQuickDndCleared}>{t('housekeeping.roomDetail.dnd.clearAction')}</Button>
            </div>}
          </section>}

          {operationalRoom.serviceDeclined && <section className="rounded-[var(--r-lg)] border border-line bg-surface-2 p-4" aria-labelledby="room-service-declined">
            <p id="room-service-declined" className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="h-2 w-2 rounded-full bg-[var(--ink-3)]" aria-hidden="true" />{t('housekeeping.roomDetail.serviceDeclined.activeLabel')}</p>
            <div className="mt-2 space-y-1 text-sm text-ink2">
              {operationalRoom.serviceDeclinedReason && <p>{t(`housekeeping.roomDetail.serviceDeclined.reason.${operationalRoom.serviceDeclinedReason}`)}</p>}
              {operationalRoom.serviceDeclinedNote && <p className="text-ink3">{operationalRoom.serviceDeclinedNote}</p>}
            </div>
          </section>}

          {openDiscrepancy && <section className="rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-4" aria-labelledby="room-discrepancy">
            <div className="flex items-center justify-between gap-3">
              <p id="room-discrepancy" className="flex items-center gap-2 text-sm font-semibold text-[var(--alert)]"><CircleAlert className="h-4 w-4" aria-hidden="true" />{t('housekeeping.roomDetail.discrepancy.activeLabel')}</p>
              {canResolveDiscrepancy && <Button variant="outline" size="sm" onClick={() => setDiscrepancyOpen(true)}>{t('housekeeping.roomDetail.discrepancy.resolveAction')}</Button>}
            </div>
            <p className="mt-2 text-sm text-ink">{t(openDiscrepancy.housekeeping_observed === 'occupied' ? 'housekeeping.roomDetail.discrepancy.summaryOccupied' : 'housekeeping.roomDetail.discrepancy.summaryVacant')}</p>
            {!canResolveDiscrepancy && <p className="mt-1 text-xs text-ink3">{t('housekeeping.roomDetail.discrepancy.awaitingResolution')}</p>}
          </section>}

          <section aria-labelledby="room-blockers">
            <h3 id="room-blockers" className="text-xs font-semibold uppercase tracking-[0.12em] text-ink3">{t('housekeeping.roomDetail.workspace.blockers')}</h3>
            <div className="mt-3 space-y-2">
              {roomWorkOrders.map((workOrder) => <div key={workOrder.id} className="flex gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-[var(--caution)]" aria-hidden="true" /><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{t('housekeeping.roomDetail.workspace.workOrder', { number: workOrder.work_order_number, title: workOrder.title })}</p><p className="mt-0.5 text-xs text-ink3">{t(`housekeeping.roomDetail.workspace.workOrderStatus.${workOrder.status}`)}</p></div></div>)}
              {roomGuestRequests.filter((request) => !['resolved', 'verified', 'cancelled'].includes(request.status)).map((request) => <div key={request.id} className="flex gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" aria-hidden="true" /><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{request.title}</p><p className="mt-0.5 text-xs text-ink3">{t('housekeeping.roomDetail.workspace.guestRequest')}</p></div></div>)}
              {roomTasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).slice(0, 2).map((task) => <div key={task.id} className="flex gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" aria-hidden="true" /><p className="min-w-0 truncate text-sm font-medium text-ink">{task.title}</p></div>)}
              {!roomWorkOrdersQuery.isLoading && !roomGuestRequestsQuery.isLoading && !roomTasksQuery.isLoading && roomWorkOrders.length === 0 && roomGuestRequests.length === 0 && roomTasks.length === 0 && <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-3 text-sm text-ink2">{t('housekeeping.roomDetail.workspace.noBlockers')}</p>}
              {(roomWorkOrdersQuery.isError || roomGuestRequestsQuery.isError || roomTasksQuery.isError) && <button type="button" onClick={() => { roomWorkOrdersQuery.refetch(); roomGuestRequestsQuery.refetch(); roomTasksQuery.refetch() }} className="text-sm font-medium text-accent underline underline-offset-4">{t('housekeeping.roomDetail.workspace.blockersUnavailable')}</button>}
            </div>
          </section>

          <section aria-labelledby="room-activity">
            <h3 id="room-activity" className="text-xs font-semibold uppercase tracking-[0.12em] text-ink3">{t('housekeeping.roomDetail.workspace.activity')}</h3>
            <div className="mt-3 space-y-3 border-l border-line pl-4">
              {activity.length > 0 ? activity.map((entry: any) => <div key={entry.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--ink-3)]" aria-hidden="true" /><p className="text-sm text-ink">{getActivityLine(entry, t)}</p><p className="mt-0.5 text-xs text-ink3">{formatHistoryTimestamp(entry.created_at, t)}</p></div>) : <p className="text-sm text-ink2">{t('housekeeping.roomDetail.history.empty')}</p>}
            </div>
          </section>

          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            {canMarkCheckout && showDepartureRow && <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}><Clock3 className="h-3.5 w-3.5" />{t('housekeeping.roomDetail.workspace.changeDeparture')}</Button>}
            {room?.assigned_to && <Button variant="outline" size="sm" onClick={() => setMsgOpen(true)}><UserRound className="h-3.5 w-3.5" />{t('housekeeping.roomDetail.workspace.message')}</Button>}
            <Button variant="outline" size="sm" onClick={() => setWoOpen(true)}><AlertTriangle className="h-3.5 w-3.5" />{t('housekeeping.roomDetail.primary.reportIssue')}</Button>
            {canManageRush && !isRush && <Button variant="outline" size="sm" onClick={() => setPriorityOpen(true)}>{t('housekeeping.roomDetail.priority.setAction')}</Button>}
            {canReportException && !operationalRoom.dnd && <Button variant="outline" size="sm" onClick={() => setAttemptOpen(true)}>{t('housekeeping.roomDetail.attempt.trigger')}</Button>}
            {canReportException && !operationalRoom.serviceDeclined && <Button variant="outline" size="sm" onClick={() => setDeclinedOpen(true)}>{t('housekeeping.roomDetail.serviceDeclined.trigger')}</Button>}
            {canReportException && !openDiscrepancy && <Button variant="outline" size="sm" onClick={() => setDiscrepancyOpen(true)}>{t('housekeeping.roomDetail.discrepancy.reportAction')}</Button>}
          </div>
        </div>

        {woOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-ink/35" onClick={() => setWoOpen(false)} aria-hidden="true" />
            <div ref={workOrderSheetRef} role="dialog" aria-modal="true" aria-labelledby="room-report-issue-title" onKeyDownCapture={(event) => { if (event.key === 'Escape') { event.preventDefault(); setWoOpen(false) } }} className="relative max-h-[88%] overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
              <div className="mb-5 flex items-start justify-between gap-4"><div><h3 id="room-report-issue-title" className="text-lg font-semibold text-ink">{t('housekeeping.roomDetail.workspace.reportIssueTitle')}</h3><p className="mt-1 text-sm text-ink3">{t('housekeeping.roomDetail.roomLabel', { roomNumber })}</p></div><Button variant="ghost" onClick={() => setWoOpen(false)} aria-label={t('housekeeping.roomDetail.closeAria')} className="min-h-10 min-w-10 p-0"><X className="h-4 w-4" /></Button></div>
              <div>
                <label htmlFor="room-wo-title" className="block text-xs font-semibold text-ink3 mb-1.5">
                  {t('housekeeping.roomDetail.workOrderForm.issueTitleLabel')} <span className="text-[var(--alert)]">*</span>
                </label>
                <input
                  id="room-wo-title"
                  type="text"
                  autoFocus
                  value={woTitle}
                  onChange={(e) => setWoTitle(e.target.value)}
                  placeholder={t('housekeeping.roomDetail.workOrderForm.titlePlaceholder')}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] shadow-sm"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="room-wo-category" className="block text-xs font-semibold text-ink3 mb-1.5">
                    {t('housekeeping.roomDetail.workOrderForm.categoryLabel')} <span className="text-[var(--alert)]">*</span>
                  </label>
                  <select
                    id="room-wo-category"
                    value={woCategory}
                    onChange={(e) => setWoCategory(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)] shadow-sm"
                  >
                    <option value="" disabled>{t('housekeeping.roomDetail.workOrderForm.selectCategory')}</option>
                    {WO_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{t(`housekeeping.roomDetail.workOrderForm.categories.${c.value}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <label htmlFor="room-wo-priority" className="block text-xs font-semibold text-ink3 mb-1.5">{t('housekeeping.roomDetail.workOrderForm.priorityLabel')}</label>
                  <select
                    id="room-wo-priority"
                    value={woPriority}
                    onChange={(e) => setWoPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)] shadow-sm"
                  >
                    <option value="urgent">{t('housekeeping.roomDetail.workOrderForm.priority.urgent')}</option>
                    <option value="normal">{t('housekeeping.roomDetail.workOrderForm.priority.normal')}</option>
                    <option value="low">{t('housekeeping.roomDetail.workOrderForm.priority.low')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink3 mb-1.5">{t('housekeeping.roomDetail.workOrderForm.detailsLabel')}</label>
                <textarea
                  value={woDescription}
                  onChange={(e) => setWoDescription(e.target.value)}
                  placeholder={t('housekeeping.roomDetail.workOrderForm.detailsPlaceholder')}
                  rows={2}
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none shadow-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs px-3.5 py-2 flex items-center gap-1.5"
                  onClick={handleCreateWorkOrder}
                  disabled={!woTitle.trim() || !woCategory || woLoading}
                >
                  {woLoading ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Wrench className="w-3 h-3" />
                  )}
                  {woLoading ? t('housekeeping.roomDetail.workOrderForm.submitting') : t('housekeeping.roomDetail.workOrderForm.submit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWoOpen(false)}
                  className="text-ink3 hover:text-ink2"
                >
                  {t('common.cancel')}
                </Button>
              </div>
              {woError && (
                <p className="text-xs text-[var(--alert)]">{woError}</p>
              )}
            </div>
          </div>
          )}

        {/* Primary footer */}
        <div className="flex-none border-t border-line bg-surface px-6 pb-6 pt-4">
          {detail.primaryAction === 'inspect' ? (
            <Button variant="primary" onClick={() => setInspectionOpen(true)} className="h-12 w-full rounded-[var(--r-md)]">
              {t('housekeeping.roomDetail.inspection.inspectAction')}
            </Button>
          ) : primaryAction && (
            <Button
              variant="primary"
              loading={advanceLoading}
              onClick={primaryAction.run}
              className="h-12 w-full rounded-[var(--r-md)]"
            >
              {primaryAction.label}
            </Button>
          )}
        </div>

        {msgOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-ink/35" onClick={() => setMsgOpen(false)} aria-hidden="true" />
            <div ref={messageSheetRef} role="dialog" aria-modal="true" aria-labelledby="room-message-title" onKeyDownCapture={(event) => { if (event.key === 'Escape') { event.preventDefault(); setMsgOpen(false) } }} className="relative rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-4"><div><h3 id="room-message-title" className="text-lg font-semibold text-ink">{t('housekeeping.roomDetail.workspace.message')}</h3><p className="mt-1 text-sm text-ink3">{assignedName}</p></div><Button variant="ghost" onClick={() => setMsgOpen(false)} aria-label={t('housekeeping.roomDetail.closeAria')} className="min-h-10 min-w-10 p-0"><X className="h-4 w-4" /></Button></div>
              <textarea autoFocus value={msgText} onChange={(event) => setMsgText(event.target.value)} placeholder={t('housekeeping.roomDetail.primary.messagePlaceholder', { name: assignedName ?? '' })} rows={3} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
              <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setMsgOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={msgLoading} disabled={!msgText.trim()} onClick={handleSendMessage}>{t('housekeeping.roomDetail.primary.send')}</Button></div>
            </div>
          </div>
        )}

        {/* Change departure sheet */}
        {sheetOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-ink/25" onClick={() => setSheetOpen(false)} aria-hidden="true" />
            <div ref={departureSheetRef} role="dialog" aria-modal="true" aria-labelledby="room-departure-title" onKeyDownCapture={(event) => { if (event.key === 'Escape') { event.preventDefault(); setSheetOpen(false) } }} className="relative flex flex-col gap-4 rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id="room-departure-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.changeDeparture.title')}</p>
                  <p className="text-[12px] text-ink3 mt-0.5">
                    {t('housekeeping.roomDetail.roomLabel', { roomNumber })}
                    {' · '}
                    {occupancy === 'DEPARTURE'
                      ? t('housekeeping.roomDetail.changeDeparture.dueOutToday')
                      : t('housekeeping.roomDetail.changeDeparture.scheduled')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setSheetOpen(false)}
                  className="shrink-0 p-1.5 rounded-lg"
                  aria-label={t('housekeeping.roomDetail.closeAria')}
                >
                  <X className="w-4 h-4 text-ink3" />
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  {t('housekeeping.roomDetail.changeDeparture.lateCheckout')}
                </p>
                <div className="flex gap-[7px] flex-wrap">
                  {LATE_CHECKOUT_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => { setLateChoice(chip); setCustomTimeMode(false) }}
                      className={`h-9 px-3 rounded-lg text-[13px] font-medium font-mono transition-colors ${
                        !customTimeMode && lateChoice === chip
                          ? 'bg-ink border border-ink text-surface'
                          : 'bg-surface border border-line text-ink hover:border-ink-4'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomTimeMode(true)}
                    className={`h-9 px-3 rounded-lg text-[13px] font-medium border border-dashed transition-colors ${
                      customTimeMode ? 'border-ink-4 text-ink' : 'border-ink-4 text-ink3 hover:text-ink2'
                    }`}
                  >
                    {t('housekeeping.roomDetail.changeDeparture.other')}
                  </button>
                </div>
                {customTimeMode && (
                  <input
                    type="time"
                    autoFocus
                    aria-label={t('housekeeping.roomDetail.departureCheckout.checkoutTimeLabel')}
                    value={checkoutTimeInput}
                    onChange={(e) => setCheckoutTimeInput(e.target.value)}
                    className="h-9 w-[120px] rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                )}
              </div>

              {canMarkStayover && (
                <div className="flex flex-col gap-2 pt-3 border-t border-line">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                    {t('housekeeping.roomDetail.changeDeparture.altLabel')}
                  </p>
                  <button
                    type="button"
                    onClick={handleMarkStayover}
                    disabled={stayoverLoading}
                    className="flex items-center gap-[11px] text-left px-3 py-2.5 rounded-lg border border-line bg-surface hover:border-ink-4 hover:bg-surface-2 transition-colors disabled:opacity-60"
                  >
                    <span className="w-[30px] h-[30px] shrink-0 rounded-lg bg-surface-3 text-ink3 flex items-center justify-center">
                      <BedDouble className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink">{t('housekeeping.roomDetail.changeDeparture.stayoverTitle')}</span>
                      <span className="block text-[11.5px] text-ink3">{t('housekeeping.roomDetail.changeDeparture.stayoverSub')}</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-ink3 shrink-0" />
                  </button>
                </div>
              )}

              <Button
                variant="primary"
                onClick={() => handleSaveCheckoutTime(customTimeMode ? checkoutTimeInput : chipLabelTo24h(lateChoice))}
                loading={saveTimeLoading}
                disabled={customTimeMode && !checkoutTimeInput}
                className="h-11"
              >
                {t('housekeeping.roomDetail.changeDeparture.confirm', { time: customTimeMode ? checkoutTimeInput : lateChoice })}
              </Button>
              <p className="text-[11.5px] text-ink3 text-center">{t('housekeeping.roomDetail.changeDeparture.autoUpdateNote')}</p>
            </div>
          </div>
        )}

        {/* Assign room clean sheet — front desk/supervisor logs a guest's mid-stay
            clean request: pick clean type + housekeeper (ranked by route fit) in one screen. */}
        {assignSheetOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-ink/25" onClick={() => setAssignSheetOpen(false)} aria-hidden="true" />
            <div ref={assignmentSheetRef} role="dialog" aria-modal="true" aria-labelledby="room-assignment-title" onKeyDownCapture={(event) => { if (event.key === 'Escape') { event.preventDefault(); setAssignSheetOpen(false) } }} className="relative flex max-h-[85%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id="room-assignment-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.assignClean.title')}</p>
                  <p className="text-[12px] text-ink3 mt-0.5">{t('housekeeping.roomDetail.assignClean.subtitle', { roomNumber })}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setAssignSheetOpen(false)}
                  className="shrink-0 p-1.5 rounded-lg"
                  aria-label={t('housekeeping.roomDetail.closeAria')}
                >
                  <X className="w-4 h-4 text-ink3" />
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  {t('housekeeping.roomDetail.assignClean.cleanTypeLabel')}
                </p>
                <div className="flex gap-[7px] flex-wrap">
                  {CLEAN_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAssignCleanType(opt.value)}
                      className={`h-9 px-3 rounded-lg text-[13px] font-medium transition-colors ${
                        assignCleanType === opt.value
                          ? 'bg-ink border border-ink text-surface'
                          : 'bg-surface border border-line text-ink hover:border-ink-4'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-3 border-t border-line">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  {t('housekeeping.roomDetail.assignClean.housekeeperLabel')}
                </p>
                {housekeeperOptions.length === 0 ? (
                  <p className="text-[12.5px] text-ink3">{t('housekeeping.roomDetail.assignClean.noHousekeepers')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {housekeeperOptions.map((hk, i) => {
                      const location = hk.building
                        ? hk.building === buildingOf(room)
                          ? t('housekeeping.roomDetail.assignClean.locationThisRoom', { building: hk.building })
                          : t('housekeeping.roomDetail.assignClean.locationOtherBuilding', { building: hk.building })
                        : t('housekeeping.roomDetail.assignClean.locationIdle')
                      const selected = assignHousekeeperId === hk.id
                      return (
                        <button
                          key={hk.id}
                          type="button"
                          onClick={() => setAssignHousekeeperId(hk.id)}
                          className={`flex items-center gap-[11px] text-left px-3 py-2.5 rounded-lg border transition-colors ${
                            selected ? 'border-ink bg-surface-2' : 'border-line bg-surface hover:border-ink-4 hover:bg-surface-2'
                          }`}
                        >
                          <span className="w-[30px] h-[30px] shrink-0 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center">
                            {hk.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="block text-[13.5px] font-medium text-ink truncate">{hk.name}</span>
                              {i === 0 && (
                                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--ready)] bg-[var(--ready-soft)] border border-[var(--ready-line)] px-[6px] py-px rounded">
                                  {t('housekeeping.roomDetail.assignClean.suggestedBadge')}
                                </span>
                              )}
                            </span>
                            <span className="block text-[11.5px] text-ink3">
                              {t('housekeeping.roomDetail.assignClean.metaLine', { count: hk.openCount, credits: hk.credits, location })}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <Button
                variant="primary"
                onClick={handleAssignRoomClean}
                loading={assignLoading}
                disabled={!assignHousekeeperId}
                className="h-11"
              >
                {t('housekeeping.roomDetail.assignClean.confirm', {
                  name: housekeeperOptions.find((h) => h.id === assignHousekeeperId)?.name ?? '',
                })}
              </Button>
            </div>
          </div>
        )}

        {roomId && <RoomPrioritySheet
          roomId={roomId}
          roomNumber={roomNumber}
          isRush={isRush}
          currentReason={operationalRoom.priorityReason}
          currentNeededBy={operationalRoom.priorityNeededBy}
          currentNote={operationalRoom.priorityNote}
          open={priorityOpen}
          onClose={() => setPriorityOpen(false)}
        />}

        {roomId && <InspectionDrawer
          roomId={roomId}
          roomNumber={roomNumber}
          roomTypeId={room?.rooms?.room_type_id ?? room?.room_type_id ?? null}
          previousCorrections={operationalRoom.recleanRequired ? (room?.reclean_corrections ?? []) : []}
          open={inspectionOpen}
          onClose={() => setInspectionOpen(false)}
        />}

        {roomId && <ServiceAttemptForm
          roomId={roomId}
          roomNumber={roomNumber}
          open={attemptOpen}
          onClose={() => setAttemptOpen(false)}
        />}

        {roomId && <RoomServiceStatusSheet
          roomId={roomId}
          roomNumber={roomNumber}
          open={declinedOpen}
          onClose={() => setDeclinedOpen(false)}
        />}

        {roomId && <OccupancyDiscrepancySheet
          roomId={roomId}
          roomNumber={roomNumber}
          pmsStatus={room?.fo_status ?? null}
          openDiscrepancy={openDiscrepancy}
          canResolve={canResolveDiscrepancy}
          open={discrepancyOpen}
          onClose={() => setDiscrepancyOpen(false)}
        />}
      </div>
    </>,
    document.body
  )
}
