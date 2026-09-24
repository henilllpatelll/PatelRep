'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, AlertTriangle, MessageSquare, Wrench, BedDouble, ChevronRight } from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi } from '@/lib/api/engineering'
import { roomsApi } from '@/lib/api/rooms'
import { notificationsApi } from '@/lib/api/notifications'
import { staffApi } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { getCleanTypeLabel, getCleanTypeShortLabel, getCleanTypeCredits, isOpenHousekeepingRoom, CLEAN_TYPE_OPTIONS, type CleanType } from '@/lib/utils/cleanType'
import { getRoomTypeCode } from '@/lib/utils/roomType'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

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
  onCheckoutTimeSaved?: (checkoutTime: string) => void
}

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

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

const STAYOVER_CLEAN_TYPES = CLEAN_TYPE_OPTIONS.filter((o) => o.value !== 'DEP')

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
 * in HousekeepingRoutes.tsx.
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

function formatLastAction(entry: any | null, room: any | null, currentUserId: string | undefined, t: TFunction): string | null {
  const status = entry?.to_status ?? room?.status
  const timestamp = entry?.created_at ?? getLastUpdateAt(room)
  if (!status || !timestamp) return null

  const actorName = entry?.actor_name ?? entry?.user_profiles?.preferred_name ?? null
  const actor =
    entry?.changed_by && entry.changed_by === currentUserId
      ? ` ${t('housekeeping.roomDetail.history.byYou')}`
      : actorName
      ? ` ${t('housekeeping.roomDetail.history.byName', { name: actorName })}`
      : ''

  return t('housekeeping.roomDetail.history.lastActionLine', {
    action: getActionLabel(status, t),
    actor,
    time: formatHistoryTimestamp(timestamp, t),
  })
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

export function RoomDetailDrawer({ room, isOpen, onClose, onCheckoutTimeSaved }: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const currentUser = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const toast = useToast()
  const drawerRef = useRef<HTMLDivElement>(null)

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
    setAssignCleanType('LIGHT')
    setAssignHousekeeperId(null)
    setWoDescription('')
    setWoPriority('normal')
    setWoError(null)
  }, [roomId, isOpen, room?.checkout_time])

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
  const riskLevel: RiskLevel | undefined = prediction?.risk_level

  const { data: lastActionData } = useQuery({
    queryKey: ['room-history-last-action', roomId],
    queryFn: () => housekeepingApi.getRoomHistory(roomId!, 1),
    enabled: !!roomId && isOpen,
    staleTime: 15_000,
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

  // Today's open board, used only to rank housekeepers by route fit when the
  // assign-clean sheet is open — not needed for the rest of the drawer.
  const { data: assignBoardData } = useQuery({
    queryKey: ['housekeeping-board-for-assign-suggestion', format(new Date(), 'yyyy-MM-dd')],
    queryFn: () => housekeepingApi.getBoard(format(new Date(), 'yyyy-MM-dd'), undefined, false),
    enabled: assignSheetOpen,
    staleTime: 15_000,
  })

  useModalFocusTrap(drawerRef, isOpen, onClose)

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? '—'
  const roomTypeName = getRoomTypeCode(room) ?? ''
  const floor = room?.rooms?.floor ?? room?.floor ?? '—'
  const vipFlag = !!room?.vip_flag
  const guestName: string | null = room?.guest_name ?? null
  const cleanTypeLabel = getCleanTypeLabel(room?.clean_type)
  // Pickup only ever means a stayover clean (Full/Light) is queued, but the
  // header eyebrow otherwise just says "Pickup" with no way to tell which —
  // surface it right in the header instead of burying it under a guest row
  // that may not even be present.
  const pickupCleanTypeShort = status === 'PICKUP' ? getCleanTypeShortLabel(room?.clean_type) : null
  const staffList: any[] = (staffData as any)?.data?.staff ?? []
  const assignedName: string | null =
    room?.user_profiles?.preferred_name ??
    room?.user_profiles?.full_name ??
    (room?.assigned_to ? staffList.find((s) => s.user_id === room.assigned_to)?.full_name ?? null : null)
  const openWorkOrder: string | null = room?.open_work_order_number ?? null

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
  const delayMinutes: number | null = prediction?.delay_minutes ?? null
  const riskFactors: string[] = prediction?.risk_factors ?? []

  const latestAction = lastActionData?.data?.[0] ?? null
  const lastAction = formatLastAction(latestAction, room, currentUser?.id, t)

  const occupancy = getOccupancy(room)
  const headerTone = getHeaderTone(status, occupancy)
  const isCleaningNow = status === 'IN_PROGRESS'
  const avgCleanMinutes: number | null = room?.rooms?.room_types?.base_clean_minutes ?? room?.room_types?.base_clean_minutes ?? null
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

  // The AI note mirrors the app's real room_readiness_prediction. Gated to
  // non-housekeepers exactly as the prior AI Prediction section was — the
  // prediction is a supervisory read, not something we surface to the cleaner.
  const aiInsight: string | null = (!isHousekeeper && prediction)
    ? [
        t('housekeeping.roomDetail.aiPrediction.riskBadge', { level: riskLevel ?? 'LOW' }),
        etaTime ? t('housekeeping.roomDetail.aiPrediction.etaSuffix', { time: etaTime }) : '',
        delayMinutes !== null && delayMinutes > 0 && checkinTime
          ? t('housekeeping.roomDetail.aiPrediction.lateForCheckin', { minutes: delayMinutes })
          : '',
        riskFactors.length > 0 ? `${riskFactors.join(', ')}.` : '',
      ].filter(Boolean).join(' ')
    : null

  // Primary drawer action — advances the room forward one real step. Every
  // branch is either a real status transition (roomsApi.updateStatus, which
  // the API validates server-side per role) or, where the room genuinely has
  // nowhere further to go (already ready/vacant), an honest no-op toast.
  const primaryAction: { label: string; run: () => void } | null = (() => {
    if (isCleaningNow) {
      return {
        label: t('housekeeping.roomDetail.primary.queueForInspection'),
        run: () => handleAdvanceStatus('CLEAN', t('housekeeping.roomDetail.primary.queuedToast', { roomNumber })),
      }
    }
    if (status === 'CLEAN' && canSupervise) {
      return {
        label: t('housekeeping.roomDetail.primary.markInspected'),
        run: () => handleAdvanceStatus('INSPECTED', t('housekeeping.roomDetail.primary.inspectedToast', { roomNumber })),
      }
    }
    if (status === 'DIRTY' || status === 'PICKUP') {
      if (!assignedName) {
        return {
          label: t('housekeeping.roomDetail.primary.assignToClean'),
          run: () => router.push('/housekeeping?assign=1'),
        }
      }
      return {
        label: t('housekeeping.roomDetail.primary.startClean'),
        run: () => handleAdvanceStatus('IN_PROGRESS', t('housekeeping.roomDetail.primary.startedToast', { roomNumber, name: assignedName })),
      }
    }
    if (status === 'OCCUPIED') {
      if (canAssignClean) {
        return {
          label: t('housekeeping.roomDetail.primary.assignRoomClean'),
          run: () => setAssignSheetOpen(true),
        }
      }
      return {
        label: t('housekeeping.roomDetail.primary.requestClean'),
        run: () => handleAdvanceStatus('IN_PROGRESS', t('housekeeping.roomDetail.primary.requestedToast', { roomNumber })),
      }
    }
    if ((status === 'OOO' || status === 'OUT_OF_ORDER' || status === 'OUT_OF_SERVICE') && canSupervise) {
      return {
        label: t('housekeeping.roomDetail.primary.returnToService'),
        run: () => handleAdvanceStatus('DIRTY', t('housekeeping.roomDetail.primary.returnedToast', { roomNumber })),
      }
    }
    if (status === 'INSPECTED') {
      return {
        label: t('housekeeping.roomDetail.primary.holdForArrival'),
        run: () => toast.success(t('housekeeping.roomDetail.primary.heldToast', { roomNumber })),
      }
    }
    return null
  })()

  if (!isOpen) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/30 backdrop-blur-sm z-drawer transition-opacity"
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
        className="fixed right-0 top-0 h-full w-[410px] max-w-full bg-white shadow-2xl border-l border-stone-200 z-drawer flex flex-col outline-none"
      >
        {/* Status-colored header */}
        <div
          className="shrink-0 flex flex-col gap-3.5 px-6 pt-4 pb-5 text-white"
          style={{
            background: `var(--${headerTone.varName})`,
            backgroundImage: headerTone.striped
              ? 'repeating-linear-gradient(135deg,rgba(255,255,255,.11) 0 7px,transparent 7px 14px)'
              : undefined,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
              {isCleaningNow && <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />}
              {t(`housekeeping.roomDetail.header.eyebrow.${headerTone.eyebrowKey}`)}
              {pickupCleanTypeShort && ` · ${pickupCleanTypeShort}`}
            </span>
            <Button
              variant="ghost"
              onClick={onClose}
              className="shrink-0 p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white"
              aria-label={t('housekeeping.roomDetail.closeAria')}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-end justify-between gap-3">
            <span className="font-display text-[46px] leading-[0.9] tracking-[-1px]">{roomNumber}</span>
            <span className="text-[12.5px] text-white/90 pb-1 text-right">
              {roomTypeName
                ? t('housekeeping.roomDetail.header.floorAndType', { floor, type: roomTypeName })
                : t('housekeeping.roomDetail.header.floorOnly', { floor })}
            </span>
          </div>
          {isCleaningNow && (
            <div className="flex flex-col gap-1.5">
              {avgCleanMinutes != null && (
                <div className="h-1 rounded-full bg-white/25 overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full"
                    style={{ width: `${Math.min(100, elapsedMinutes != null ? (elapsedMinutes / avgCleanMinutes) * 100 : 0)}%` }}
                  />
                </div>
              )}
              <div className="flex justify-between font-mono text-[11px] text-white/90">
                <span>
                  {startedAtLabel ? t('housekeeping.roomDetail.header.startedAt', { time: startedAtLabel }) : t('housekeeping.roomDetail.header.inProgress')}
                  {elapsedMinutes != null ? ` · ${t('housekeeping.roomDetail.header.minutesIn', { minutes: elapsedMinutes })}` : ''}
                </span>
                {avgCleanMinutes != null && <span>{t('housekeeping.roomDetail.header.avgMinutes', { minutes: avgCleanMinutes })}</span>}
              </div>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Guest + housekeeper rows */}
          {(guestName || assignedName) && (
            <div className="flex flex-col gap-3">
              {guestName && (
                <div className="flex items-center gap-[11px]">
                  <span className="w-[30px] h-[30px] shrink-0 rounded-full bg-[var(--info)] text-white text-[11px] font-semibold flex items-center justify-center">
                    {guestName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] text-stone-900 truncate">{guestName}</p>
                    {cleanTypeLabel && <p className="text-[11.5px] text-stone-400">{cleanTypeLabel}</p>}
                  </div>
                  {vipFlag && (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-amber-700 bg-amber-100 border border-amber-200 px-[7px] py-px rounded">
                      {t('housekeeping.roomCard.vip')}
                    </span>
                  )}
                </div>
              )}
              {assignedName && (
                <div className="flex items-center gap-[11px]">
                  <span className="w-[30px] h-[30px] shrink-0 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center">
                    {assignedName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] text-stone-900 truncate">{assignedName}</p>
                    <p className="text-[11.5px] text-stone-400 truncate">
                      {lastAction ??
                        (etaTime
                          ? t('housekeeping.roomDetail.header.predictedReady', { time: etaTime })
                          : t('housekeeping.roomDetail.header.floorBoard', { floor }))}
                    </p>
                  </div>
                  <span className={`text-[12px] shrink-0 ${isCleaningNow ? 'text-[var(--progress)]' : 'text-stone-400'}`}>
                    {isCleaningNow ? t('housekeeping.roomDetail.header.cleaningPill') : t('housekeeping.roomDetail.header.assignedPill')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Fact rows: change departure + open work orders */}
          <div className="flex flex-col">
            {showDepartureRow && (
              canMarkCheckout ? (
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="flex items-center justify-between gap-3.5 w-full py-2.5 border-t border-stone-100 bg-transparent text-left hover:opacity-60 transition-opacity"
                >
                  <span className="text-[12.5px] text-stone-400">{departureRowLabel}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-[13.5px] text-stone-900">{departureRowValue}</span>
                    <span className="text-[12px] text-accent">{t('housekeeping.roomDetail.changeDeparture.change')}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-accent" />
                  </span>
                </button>
              ) : (
                <div className="flex items-baseline justify-between gap-4 py-2.5 border-t border-stone-100">
                  <span className="text-[12.5px] text-stone-400">{departureRowLabel}</span>
                  <span className="font-mono text-[13.5px] text-stone-800">{departureRowValue}</span>
                </div>
              )
            )}
            <div className="flex items-baseline justify-between gap-4 py-2.5 border-t border-stone-100">
              <span className="text-[12.5px] text-stone-400">{t('housekeeping.roomDetail.openWorkOrderFactLabel')}</span>
              <span className="font-mono text-[13.5px] text-stone-800">{openWorkOrder ?? '0'}</span>
            </div>
          </div>

          {/* AI note */}
          {aiInsight && (
            <div className="flex flex-col gap-1.5 pt-4 border-t border-stone-100">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ai)]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
                </svg>
                {t('housekeeping.roomDetail.aiPrediction.heading')}
              </span>
              <p className="font-display italic text-[17px] leading-[1.35] text-stone-900">{aiInsight}</p>
            </div>
          )}

          {/* Report-issue work-order form (opened from the footer report button) */}
          {woOpen && (
            <div id="room-report-issue-form" className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 space-y-3">
              <div>
                <label htmlFor="room-wo-title" className="block text-xs font-semibold text-stone-500 mb-1.5">
                  {t('housekeeping.roomDetail.workOrderForm.issueTitleLabel')} <span className="text-rose-400">*</span>
                </label>
                <input
                  id="room-wo-title"
                  type="text"
                  value={woTitle}
                  onChange={(e) => setWoTitle(e.target.value)}
                  placeholder={t('housekeeping.roomDetail.workOrderForm.titlePlaceholder')}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="room-wo-category" className="block text-xs font-semibold text-stone-500 mb-1.5">
                    {t('housekeeping.roomDetail.workOrderForm.categoryLabel')} <span className="text-rose-400">*</span>
                  </label>
                  <select
                    id="room-wo-category"
                    value={woCategory}
                    onChange={(e) => setWoCategory(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                  >
                    <option value="" disabled>{t('housekeeping.roomDetail.workOrderForm.selectCategory')}</option>
                    {WO_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{t(`housekeeping.roomDetail.workOrderForm.categories.${c.value}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <label htmlFor="room-wo-priority" className="block text-xs font-semibold text-stone-500 mb-1.5">{t('housekeeping.roomDetail.workOrderForm.priorityLabel')}</label>
                  <select
                    id="room-wo-priority"
                    value={woPriority}
                    onChange={(e) => setWoPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                  >
                    <option value="urgent">{t('housekeeping.roomDetail.workOrderForm.priority.urgent')}</option>
                    <option value="normal">{t('housekeeping.roomDetail.workOrderForm.priority.normal')}</option>
                    <option value="low">{t('housekeeping.roomDetail.workOrderForm.priority.low')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-500 mb-1.5">{t('housekeeping.roomDetail.workOrderForm.detailsLabel')}</label>
                <textarea
                  value={woDescription}
                  onChange={(e) => setWoDescription(e.target.value)}
                  placeholder={t('housekeeping.roomDetail.workOrderForm.detailsPlaceholder')}
                  rows={2}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none shadow-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs px-3.5 py-2 flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600"
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
                  className="text-stone-400 hover:text-stone-600"
                >
                  {t('common.cancel')}
                </Button>
              </div>
              {woError && (
                <p className="text-xs text-rose-500">{woError}</p>
              )}
            </div>
          )}
        </div>

        {/* Primary footer */}
        <div className="flex-none px-6 pt-4 pb-[22px] border-t border-stone-100 flex gap-2.5">
          {primaryAction && (
            <Button
              variant="primary"
              loading={advanceLoading}
              onClick={primaryAction.run}
              className="flex-1 h-11 rounded-[10px]"
            >
              {primaryAction.label}
            </Button>
          )}
          <div className="relative shrink-0">
            <Button
              variant="outline"
              onClick={() =>
                room?.assigned_to ? setMsgOpen((v) => !v) : toast.success(t('housekeeping.roomDetail.primary.noHousekeeper'))
              }
              aria-label={t('housekeeping.roomDetail.primary.messageHousekeeping')}
              title={t('housekeeping.roomDetail.primary.messageHousekeeping')}
              className="w-11 h-11 rounded-[10px] p-0"
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
            {msgOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMsgOpen(false)} />
                <div className="absolute right-0 bottom-[52px] z-20 w-64 bg-white border border-stone-200 rounded-[10px] shadow-2xl p-2.5 flex flex-col gap-2">
                  <textarea
                    autoFocus
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    placeholder={t('housekeeping.roomDetail.primary.messagePlaceholder', { name: assignedName ?? '' })}
                    rows={2}
                    className="w-full resize-none text-[12.5px] px-2.5 py-2 border border-stone-200 rounded-lg bg-stone-50 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setMsgOpen(false)}>{t('common.cancel')}</Button>
                    <Button variant="primary" size="sm" loading={msgLoading} disabled={!msgText.trim()} onClick={handleSendMessage}>
                      {t('housekeeping.roomDetail.primary.send')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setWoOpen(true)
              requestAnimationFrame(() => document.getElementById('room-report-issue-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
            }}
            aria-label={t('housekeeping.roomDetail.primary.reportIssue')}
            title={t('housekeeping.roomDetail.primary.reportIssue')}
            className="w-11 h-11 rounded-[10px] p-0 shrink-0 hover:bg-[var(--alert-soft)] hover:text-[var(--alert)] hover:border-[var(--alert-line)]"
          >
            <AlertTriangle className="w-4 h-4" />
          </Button>
        </div>

        {/* Change departure sheet */}
        {sheetOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-stone-900/25" onClick={() => setSheetOpen(false)} aria-hidden="true" />
            <div className="relative bg-white border-t border-stone-200 rounded-t-2xl shadow-2xl px-6 pt-[18px] pb-[22px] flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[24px] leading-[1.1] text-stone-900">{t('housekeeping.roomDetail.changeDeparture.title')}</p>
                  <p className="text-[12px] text-stone-400 mt-0.5">
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
                  <X className="w-4 h-4 text-stone-400" />
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
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
                          ? 'bg-stone-900 border border-stone-900 text-white'
                          : 'bg-white border border-stone-200 text-stone-800 hover:border-stone-300'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomTimeMode(true)}
                    className={`h-9 px-3 rounded-lg text-[13px] font-medium border border-dashed transition-colors ${
                      customTimeMode ? 'border-stone-400 text-stone-800' : 'border-stone-300 text-stone-500 hover:text-stone-700'
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
                    className="h-9 w-[120px] rounded-lg border border-stone-200 bg-white px-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                )}
              </div>

              {canMarkStayover && (
                <div className="flex flex-col gap-2 pt-3 border-t border-stone-100">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                    {t('housekeeping.roomDetail.changeDeparture.altLabel')}
                  </p>
                  <button
                    type="button"
                    onClick={handleMarkStayover}
                    disabled={stayoverLoading}
                    className="flex items-center gap-[11px] text-left px-3 py-2.5 rounded-lg border border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 transition-colors disabled:opacity-60"
                  >
                    <span className="w-[30px] h-[30px] shrink-0 rounded-lg bg-stone-100 text-stone-500 flex items-center justify-center">
                      <BedDouble className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium text-stone-900">{t('housekeeping.roomDetail.changeDeparture.stayoverTitle')}</span>
                      <span className="block text-[11.5px] text-stone-400">{t('housekeeping.roomDetail.changeDeparture.stayoverSub')}</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
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
              <p className="text-[11.5px] text-stone-400 text-center">{t('housekeeping.roomDetail.changeDeparture.autoUpdateNote')}</p>
            </div>
          </div>
        )}

        {/* Assign room clean sheet — front desk/supervisor logs a guest's mid-stay
            clean request: pick clean type + housekeeper (ranked by route fit) in one screen. */}
        {assignSheetOpen && (
          <div className="absolute inset-0 z-20 flex flex-col justify-end">
            <div className="absolute inset-0 bg-stone-900/25" onClick={() => setAssignSheetOpen(false)} aria-hidden="true" />
            <div className="relative bg-white border-t border-stone-200 rounded-t-2xl shadow-2xl px-6 pt-[18px] pb-[22px] flex flex-col gap-4 max-h-[85%] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[24px] leading-[1.1] text-stone-900">{t('housekeeping.roomDetail.assignClean.title')}</p>
                  <p className="text-[12px] text-stone-400 mt-0.5">{t('housekeeping.roomDetail.assignClean.subtitle', { roomNumber })}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setAssignSheetOpen(false)}
                  className="shrink-0 p-1.5 rounded-lg"
                  aria-label={t('housekeeping.roomDetail.closeAria')}
                >
                  <X className="w-4 h-4 text-stone-400" />
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                  {t('housekeeping.roomDetail.assignClean.cleanTypeLabel')}
                </p>
                <div className="flex gap-[7px] flex-wrap">
                  {STAYOVER_CLEAN_TYPES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAssignCleanType(opt.value)}
                      className={`h-9 px-3 rounded-lg text-[13px] font-medium transition-colors ${
                        assignCleanType === opt.value
                          ? 'bg-stone-900 border border-stone-900 text-white'
                          : 'bg-white border border-stone-200 text-stone-800 hover:border-stone-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-3 border-t border-stone-100">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
                  {t('housekeeping.roomDetail.assignClean.housekeeperLabel')}
                </p>
                {housekeeperOptions.length === 0 ? (
                  <p className="text-[12.5px] text-stone-400">{t('housekeeping.roomDetail.assignClean.noHousekeepers')}</p>
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
                            selected ? 'border-stone-900 bg-stone-50' : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                          }`}
                        >
                          <span className="w-[30px] h-[30px] shrink-0 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center justify-center">
                            {hk.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="block text-[13.5px] font-medium text-stone-900 truncate">{hk.name}</span>
                              {i === 0 && (
                                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.04em] text-emerald-700 bg-emerald-100 border border-emerald-200 px-[6px] py-px rounded">
                                  {t('housekeeping.roomDetail.assignClean.suggestedBadge')}
                                </span>
                              )}
                            </span>
                            <span className="block text-[11.5px] text-stone-400">
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
      </div>
    </>,
    document.body
  )
}
