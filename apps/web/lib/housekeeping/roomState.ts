import { getCleanTypeCredits, isOpenHousekeepingRoom, type CleanType } from '@/lib/utils/cleanType'

export type HousekeepingAttentionCode =
  | 'rush'
  | 'arrival_risk'
  | 'dnd'
  | 'dnd_welfare_escalation'
  | 'return_later_due'
  | 'service_declined'
  | 'failed_inspection'
  | 'reclean'
  | 'occupancy_discrepancy'
  | 'ooo_arrival_conflict'
  | 'unassigned_priority_room'
  | 'open_blocking_work_order'

export type HousekeepingAttentionSeverity = 'critical' | 'high' | 'medium'

export interface HousekeepingAttentionItem {
  code: HousekeepingAttentionCode
  severity: HousekeepingAttentionSeverity
}

export interface HousekeepingOperationalRoom {
  roomId: string
  roomNumber: string
  roomType: string | null
  building: string | null
  floor: number | null
  occupancyStatus: string | null
  housekeepingStatus: string
  cleanType: CleanType | null
  assignedHousekeeperId: string | null
  assignmentState: 'assigned' | 'unassigned'
  priority: number | null
  isVip: boolean
  priorityReason: string | null
  priorityNeededBy: string | null
  priorityNote: string | null
  dnd: boolean
  dndRetryAt: string | null
  dndStartedAt: string | null
  dndAttemptCount: number
  dndLastAttemptAt: string | null
  serviceDeclined: boolean
  serviceDeclinedReason: string | null
  serviceDeclinedNote: string | null
  occupancyDiscrepancyId: string | null
  occupancyDiscrepancyType: 'occupied' | 'vacant' | null
  occupancyDiscrepancyReportedAt: string | null
  checkoutTime: string | null
  checkinTime: string | null
  hasOpenWorkOrder: boolean
  hasOpenBlockingWorkOrder: boolean
  openTaskCount: number
  guestRequestCount: number
  inspectionRequired: boolean
  inspectionStatus: string | null
  recleanRequired: boolean
  occupancyDiscrepancy: boolean
  predictionRisk: 'LOW' | 'MEDIUM' | 'HIGH' | null
  predictedReadyAt: string | null
  lastCleanedAt: string | null
  currentCleaningDurationMinutes: number | null
  lateCheckoutTime: string | null
  source: Record<string, any>
}

export interface HousekeepingRoomMetrics {
  total: number
  needsCleaning: number
  inProgress: number
  awaitingInspection: number
  ready: number
  outOfOrder: number
  atRisk: number
  unassigned: number
  rush: number
  dndOrServiceDeclined: number
  failedInspection: number
  discrepancy: number
}

export type StaffAvailability = 'available' | 'working' | 'on_break' | 'off_shift' | 'unavailable'

export const DEFAULT_WORKLOAD_TARGET = 16

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

function asCleanType(value: unknown): CleanType | null {
  return value === 'DEP' || value === 'FULL' || value === 'LIGHT' ? value : null
}

function asRisk(value: unknown): HousekeepingOperationalRoom['predictionRisk'] {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' ? value : null
}

function asCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Adapts the existing board/My Rooms payload into a stable presentation model.
 * Fields not returned by an endpoint remain explicit null/false values instead
 * of pretending that a backend capability exists.
 */
export function normalizeHousekeepingRoom(raw: unknown): HousekeepingOperationalRoom {
  const source = asRecord(raw)
  const room = asRecord(source.rooms)
  const roomType = asRecord(room.room_types)
  const prediction = asRecord(source.prediction)
  const inspectionStatus = source.inspection_status ?? source.latest_inspection_result ?? null
  const workOrderStatus = source.open_work_order_status ?? null
  const workOrderPriority = source.open_work_order_priority ?? null

  return {
    roomId: String(source.room_id ?? source.id ?? ''),
    roomNumber: String(room.room_number ?? source.room_number ?? ''),
    roomType: roomType.code ?? roomType.name ?? source.room_type_name ?? source.room_type_code ?? null,
    building: room.building ?? source.building ?? null,
    floor: typeof room.floor === 'number' ? room.floor : typeof source.floor === 'number' ? source.floor : null,
    occupancyStatus: source.fo_status ?? null,
    housekeepingStatus: String(source.status ?? 'DIRTY'),
    cleanType: asCleanType(source.clean_type),
    assignedHousekeeperId: source.assigned_to ?? null,
    assignmentState: source.assigned_to ? 'assigned' : 'unassigned',
    priority: typeof source.priority === 'number' ? source.priority : null,
    isVip: source.vip_flag === true,
    priorityReason: source.priority_reason ?? null,
    priorityNeededBy: source.priority_needed_by ?? null,
    priorityNote: source.priority_note ?? null,
    dnd: source.dnd_flag === true,
    dndRetryAt: source.dnd_retry_at ?? source.retry_at ?? null,
    dndStartedAt: source.dnd_started_at ?? null,
    dndAttemptCount: asCount(source.dnd_attempt_count),
    dndLastAttemptAt: source.dnd_last_attempt_at ?? null,
    serviceDeclined: source.do_not_service === true,
    serviceDeclinedReason: source.service_declined_reason ?? null,
    serviceDeclinedNote: source.service_declined_note ?? null,
    occupancyDiscrepancyId: source.occupancy_discrepancy_id ?? null,
    occupancyDiscrepancyType: source.occupancy_discrepancy_type === 'occupied' || source.occupancy_discrepancy_type === 'vacant'
      ? source.occupancy_discrepancy_type
      : null,
    occupancyDiscrepancyReportedAt: source.occupancy_discrepancy_reported_at ?? null,
    checkoutTime: source.checkout_time ?? null,
    checkinTime: source.checkin_time ?? prediction.checkin_time ?? null,
    hasOpenWorkOrder: Boolean(source.open_work_order_id ?? source.open_work_order_number),
    hasOpenBlockingWorkOrder: source.open_work_order_blocks_housekeeping === true
      || workOrderPriority === 'urgent'
      || workOrderStatus === 'on_hold',
    openTaskCount: asCount(source.open_task_count),
    guestRequestCount: asCount(source.guest_request_count),
    inspectionRequired: source.inspection_required === true,
    inspectionStatus: typeof inspectionStatus === 'string' ? inspectionStatus : null,
    recleanRequired: source.reclean_required === true || source.reclean_requested_at != null,
    occupancyDiscrepancy: source.occupancy_discrepancy === true || source.occupancy_discrepancy_type != null,
    predictionRisk: asRisk(prediction.risk_level ?? source.risk_level),
    predictedReadyAt: prediction.predicted_ready_at ?? source.predicted_ready_at ?? null,
    lastCleanedAt: source.last_cleaned_at ?? source.last_clean_ended_at ?? null,
    currentCleaningDurationMinutes: typeof source.current_cleaning_duration_minutes === 'number'
      ? source.current_cleaning_duration_minutes
      : null,
    lateCheckoutTime: source.late_checkout_requested_time ?? source.late_checkout_request?.requested_time ?? null,
    source,
  }
}

export function needsHousekeepingWork(room: Pick<HousekeepingOperationalRoom, 'housekeepingStatus'>): boolean {
  return isOpenHousekeepingRoom({ status: room.housekeepingStatus })
}

/** Property's configured DND welfare policy (Programs > dnd_welfare_policies); pass through
 * from programsApi.overview() -- never hardcode a threshold. */
export interface DndWelfarePolicyInput {
  thresholdHours: number
}

/** Escalation is flagged starting this long before the configured threshold, not only once overdue. */
const WELFARE_ESCALATION_LEAD_MINUTES = 60

export interface DndWelfareStatus {
  escalatesAt: Date
  remainingMinutes: number
  overdue: boolean
}

/** One operational answer for whether a room may be entered right now. Deferred
 * work (DND/return later/discrepancy) retains workload; cancelled or unavailable
 * work (service declined/OOO) does not. */
export type HousekeepingExecutionBlock = 'dnd' | 'return_later' | 'service_declined' | 'occupancy_discrepancy' | 'out_of_order' | 'maintenance' | null

export function getHousekeepingExecutionBlock(
  room: Pick<HousekeepingOperationalRoom, 'housekeepingStatus' | 'dnd' | 'dndRetryAt' | 'serviceDeclined' | 'occupancyDiscrepancy' | 'occupancyDiscrepancyId' | 'hasOpenBlockingWorkOrder'>,
  now: Date = new Date(),
): HousekeepingExecutionBlock {
  if (['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.housekeepingStatus)) return 'out_of_order'
  if (room.serviceDeclined) return 'service_declined'
  if (room.occupancyDiscrepancy || room.occupancyDiscrepancyId) return 'occupancy_discrepancy'
  if (room.hasOpenBlockingWorkOrder) return 'maintenance'
  if (room.dnd) return 'dnd'
  if (room.dndRetryAt && new Date(room.dndRetryAt).getTime() > now.getTime()) return 'return_later'
  return null
}

/** Null when the room isn't DND, the start time is unknown, or no policy was supplied
 * (Room Detail only renders this once Programs' dnd_welfare_policies is loaded). */
export function getDndWelfareStatus(
  room: Pick<HousekeepingOperationalRoom, 'dnd' | 'dndStartedAt'>,
  policy: DndWelfarePolicyInput | null | undefined,
  now: Date = new Date(),
): DndWelfareStatus | null {
  if (!room.dnd || !room.dndStartedAt || !policy) return null
  const started = new Date(room.dndStartedAt)
  if (Number.isNaN(started.getTime())) return null
  const escalatesAt = new Date(started.getTime() + policy.thresholdHours * 60 * 60 * 1000)
  const remainingMinutes = Math.round((escalatesAt.getTime() - now.getTime()) / 60000)
  return { escalatesAt, remainingMinutes, overdue: remainingMinutes <= 0 }
}

export interface DeriveAttentionOptions {
  now?: Date
  dndWelfarePolicy?: DndWelfarePolicyInput | null
}

export function deriveRoomAttentionItems(
  room: HousekeepingOperationalRoom,
  options: DeriveAttentionOptions = {},
): HousekeepingAttentionItem[] {
  const items: HousekeepingAttentionItem[] = []
  const now = options.now ?? new Date()
  const isRushPriority = room.priority !== null && room.priority <= 2
  const isPriorityWork = room.isVip || isRushPriority
  const isOutOfOrder = ['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.housekeepingStatus)

  if (room.dnd) items.push({ code: 'dnd', severity: 'critical' })
  const welfare = getDndWelfareStatus(room, options.dndWelfarePolicy, now)
  if (welfare && welfare.remainingMinutes <= WELFARE_ESCALATION_LEAD_MINUTES) {
    items.push({ code: 'dnd_welfare_escalation', severity: welfare.overdue ? 'critical' : 'high' })
  }
  if (room.dndRetryAt && now.getTime() >= new Date(room.dndRetryAt).getTime()) {
    items.push({ code: 'return_later_due', severity: 'medium' })
  }
  if (room.serviceDeclined) items.push({ code: 'service_declined', severity: 'medium' })
  if (isRushPriority) items.push({ code: 'rush', severity: 'high' })
  if (room.predictionRisk === 'HIGH' || room.predictionRisk === 'MEDIUM') {
    items.push({ code: 'arrival_risk', severity: room.predictionRisk === 'HIGH' ? 'critical' : 'high' })
  }
  if (room.inspectionStatus === 'failed') items.push({ code: 'failed_inspection', severity: 'high' })
  if (room.recleanRequired) items.push({ code: 'reclean', severity: 'high' })
  if (room.occupancyDiscrepancy) items.push({ code: 'occupancy_discrepancy', severity: 'critical' })
  if (isOutOfOrder && room.checkinTime) items.push({ code: 'ooo_arrival_conflict', severity: 'critical' })
  if (needsHousekeepingWork(room) && room.assignmentState === 'unassigned' && isPriorityWork) {
    items.push({ code: 'unassigned_priority_room', severity: 'high' })
  }
  if (room.hasOpenBlockingWorkOrder) items.push({ code: 'open_blocking_work_order', severity: 'high' })

  return items
}

export type RoomCardStatusKey = 'vacantDirty' | 'pickup' | 'cleaning' | 'inspect' | 'ready'
  | 'reclean' | 'outOfOrder' | 'dnd' | 'serviceDeclined' | 'occupied'
export type RoomCardContextKey = 'departure' | 'fullClean' | 'lightClean' | 'awaitingInspection' | 'reclean' | null
export type RoomCardTimingKey = 'arrival' | 'dueOut' | 'checkout' | 'lateCheckout' | 'cleaningDuration' | 'cleanedAt' | 'retryAt'
export type RoomCardSecondarySignal = { kind: 'workOrder' | 'guestRequest' | 'task'; count: number }

export interface RoomCardPresentation {
  statusKey: RoomCardStatusKey
  contextKey: RoomCardContextKey
  timing: { key: RoomCardTimingKey; at?: string; minutes?: number } | null
  isRush: boolean
  isVip: boolean
  assigneeKey: 'assigned' | 'unassigned'
  assigneeName: string | null
  primaryAttention: HousekeepingAttentionItem | null
  secondarySignals: RoomCardSecondarySignal[]
}

const PRIMARY_ATTENTION_ORDER: HousekeepingAttentionCode[] = [
  'dnd_welfare_escalation',
  'arrival_risk',
  'ooo_arrival_conflict',
  'failed_inspection',
  'reclean',
  'open_blocking_work_order',
  'occupancy_discrepancy',
  'dnd',
  'return_later_due',
  'service_declined',
  'unassigned_priority_room',
]

/** Selects one explainable exception for the room card; Rush is already a top-level tag. */
export function getPrimaryRoomAttention(room: HousekeepingOperationalRoom, options: DeriveAttentionOptions = {}): HousekeepingAttentionItem | null {
  const items = deriveRoomAttentionItems(room, options)
  for (const code of PRIMARY_ATTENTION_ORDER) {
    const item = items.find((candidate) => candidate.code === code)
    if (item) return item
  }
  return null
}

function getRoomCardStatusKey(room: HousekeepingOperationalRoom): RoomCardStatusKey {
  if (room.dnd) return 'dnd'
  if (room.serviceDeclined) return 'serviceDeclined'
  if (room.recleanRequired || room.inspectionStatus === 'failed') return 'reclean'
  switch (room.housekeepingStatus) {
    case 'PICKUP': return 'pickup'
    case 'IN_PROGRESS': return 'cleaning'
    case 'CLEAN': return 'inspect'
    case 'INSPECTED': return 'ready'
    case 'OOO':
    case 'OUT_OF_ORDER':
    case 'OUT_OF_SERVICE': return 'outOfOrder'
    case 'OCCUPIED': return 'occupied'
    default: return 'vacantDirty'
  }
}

function getRoomCardContext(room: HousekeepingOperationalRoom, statusKey: RoomCardStatusKey): RoomCardContextKey {
  if (statusKey === 'inspect') return 'awaitingInspection'
  if (statusKey === 'reclean') return 'reclean'
  switch (room.cleanType) {
    case 'DEP': return 'departure'
    case 'FULL': return 'fullClean'
    case 'LIGHT': return 'lightClean'
    default: return null
  }
}

function getRoomCardTiming(room: HousekeepingOperationalRoom, statusKey: RoomCardStatusKey, isRush: boolean): RoomCardPresentation['timing'] {
  if (room.lateCheckoutTime) return { key: 'lateCheckout', at: room.lateCheckoutTime }
  // Shown regardless of dnd flag: a "return later" attempt clears dnd but keeps the retry time live.
  if (room.dndRetryAt) return { key: 'retryAt', at: room.dndRetryAt }
  if (statusKey === 'cleaning' && room.currentCleaningDurationMinutes !== null) {
    return { key: 'cleaningDuration', minutes: room.currentCleaningDurationMinutes }
  }
  if (statusKey === 'inspect' && room.lastCleanedAt) return { key: 'cleanedAt', at: room.lastCleanedAt }
  if ((statusKey === 'outOfOrder' || statusKey === 'ready' || isRush) && room.checkinTime) return { key: 'arrival', at: room.checkinTime }
  if (room.checkoutTime) return { key: room.occupancyStatus === 'VAC' ? 'checkout' : 'dueOut', at: room.checkoutTime }
  if (room.checkinTime) return { key: 'arrival', at: room.checkinTime }
  return null
}

function getAssigneeName(room: HousekeepingOperationalRoom): string | null {
  const profile = asRecord(room.source.user_profiles)
  const name = profile.preferred_name ?? profile.full_name ?? room.source.assigned_to_name ?? null
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * Translates normalized board data into the deliberately compact RoomCard model.
 * It carries translation keys rather than UI copy so the card stays locale-safe.
 */
export function getRoomCardPresentation(
  room: HousekeepingOperationalRoom,
  counts: { workOrderCount?: number; guestRequestCount?: number; taskCount?: number } = {},
): RoomCardPresentation {
  const isRush = deriveRoomAttentionItems(room).some((item) => item.code === 'rush')
  const statusKey = getRoomCardStatusKey(room)
  const assigneeName = getAssigneeName(room)
  const secondarySignals: RoomCardSecondarySignal[] = []
  const workOrderCount = counts.workOrderCount ?? (room.hasOpenWorkOrder ? 1 : 0)
  if (workOrderCount > 0) secondarySignals.push({ kind: 'workOrder', count: workOrderCount })
  if ((counts.guestRequestCount ?? room.guestRequestCount) > 0) secondarySignals.push({ kind: 'guestRequest', count: counts.guestRequestCount ?? room.guestRequestCount })
  if ((counts.taskCount ?? room.openTaskCount) > 0) secondarySignals.push({ kind: 'task', count: counts.taskCount ?? room.openTaskCount })

  return {
    statusKey,
    contextKey: getRoomCardContext(room, statusKey),
    timing: getRoomCardTiming(room, statusKey, isRush),
    isRush,
    isVip: room.isVip,
    assigneeKey: room.assignmentState,
    assigneeName,
    primaryAttention: getPrimaryRoomAttention(room),
    secondarySignals,
  }
}

export function getHousekeepingRoomMetrics(rooms: HousekeepingOperationalRoom[]): HousekeepingRoomMetrics {
  // Pass only the room here: Array#map supplies an index as a second argument,
  // which is not the optional DeriveAttentionOptions parameter.
  const attention = rooms.map((room) => deriveRoomAttentionItems(room))
  const countAttention = (code: HousekeepingAttentionCode) => attention.filter((items) => items.some((item) => item.code === code)).length

  return {
    total: rooms.length,
    needsCleaning: rooms.filter(needsHousekeepingWork).length,
    inProgress: rooms.filter((room) => room.housekeepingStatus === 'IN_PROGRESS').length,
    awaitingInspection: rooms.filter((room) => room.housekeepingStatus === 'CLEAN' && room.inspectionRequired).length,
    ready: rooms.filter((room) => room.housekeepingStatus === 'INSPECTED').length,
    outOfOrder: rooms.filter((room) => ['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.housekeepingStatus)).length,
    atRisk: rooms.filter((room) => room.predictionRisk === 'HIGH' || room.predictionRisk === 'MEDIUM').length,
    unassigned: rooms.filter((room) => needsHousekeepingWork(room) && room.assignmentState === 'unassigned').length,
    rush: countAttention('rush'),
    dndOrServiceDeclined: rooms.filter((room) => room.dnd || room.serviceDeclined).length,
    failedInspection: countAttention('failed_inspection'),
    discrepancy: countAttention('occupancy_discrepancy'),
  }
}

/** Reads property configuration while retaining the legacy 16-credit fallback. */
export function getDefaultWorkloadTarget(settings?: { housekeeping_target_credits?: number | null; default_target_credits?: number | null }): number {
  const candidate = settings?.default_target_credits ?? settings?.housekeeping_target_credits
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : DEFAULT_WORKLOAD_TARGET
}

export function getRoomWorkloadCredits(room: Pick<HousekeepingOperationalRoom, 'cleanType'> & Partial<HousekeepingOperationalRoom>, weights?: Partial<Record<CleanType, number>> | null): number {
  const block = getHousekeepingExecutionBlock(room as HousekeepingOperationalRoom)
  if (block === 'service_declined' || block === 'out_of_order') return 0
  return getCleanTypeCredits(room.cleanType, weights)
}

/**
 * One execution order for Team Plan and a housekeeper's personal list. This
 * remains a presentation-only sort: persisted assignment sequence is still the
 * source of truth whenever it is available from the API.
 */
export function compareHousekeepingExecutionOrder(
  left: HousekeepingOperationalRoom,
  right: HousekeepingOperationalRoom,
  now: Date = new Date(),
): number {
  const guestLeft = left.guestRequestCount > 0 ? 0 : 1
  const guestRight = right.guestRequestCount > 0 ? 0 : 1
  if (guestLeft !== guestRight) return guestLeft - guestRight

  const rushLeft = deriveRoomAttentionItems(left, { now }).some((item) => item.code === 'rush') ? 0 : 1
  const rushRight = deriveRoomAttentionItems(right, { now }).some((item) => item.code === 'rush') ? 0 : 1
  if (rushLeft !== rushRight) return rushLeft - rushRight

  const recleanLeft = left.recleanRequired ? 0 : 1
  const recleanRight = right.recleanRequired ? 0 : 1
  if (recleanLeft !== recleanRight) return recleanLeft - recleanRight

  const returnDueLeft = left.dndRetryAt && new Date(left.dndRetryAt).getTime() <= now.getTime() ? 0 : 1
  const returnDueRight = right.dndRetryAt && new Date(right.dndRetryAt).getTime() <= now.getTime() ? 0 : 1
  if (returnDueLeft !== returnDueRight) return returnDueLeft - returnDueRight

  const riskRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const riskLeft = left.predictionRisk ? riskRank[left.predictionRisk] : 3
  const riskRight = right.predictionRisk ? riskRank[right.predictionRisk] : 3
  if (riskLeft !== riskRight) return riskLeft - riskRight

  const arrivalLeft = left.checkinTime ? new Date(left.checkinTime).getTime() : Infinity
  const arrivalRight = right.checkinTime ? new Date(right.checkinTime).getTime() : Infinity
  if (arrivalLeft !== arrivalRight) return arrivalLeft - arrivalRight

  const buildingLeft = left.building ?? ''
  const buildingRight = right.building ?? ''
  if (buildingLeft !== buildingRight) return buildingLeft.localeCompare(buildingRight)
  const floorLeft = left.floor ?? 0
  const floorRight = right.floor ?? 0
  if (floorLeft !== floorRight) return floorLeft - floorRight
  return left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true })
}

/** Maps actual shift-session/scheduling data only; it never implies staff location. */
export function normalizeStaffAvailability(input: {
  shiftSession?: { status?: string | null } | null
  isScheduled?: boolean | null
}): StaffAvailability {
  switch (input.shiftSession?.status) {
    case 'active': return 'working'
    case 'on_break': return 'on_break'
    case 'ended': return 'off_shift'
    default: return input.isScheduled ? 'available' : 'unavailable'
  }
}

const SEVERITY_SCORE: Record<HousekeepingAttentionSeverity, number> = { critical: 3, high: 2, medium: 1 }

function attentionScore(room: HousekeepingOperationalRoom): number {
  return deriveRoomAttentionItems(room).reduce((highest, item) => Math.max(highest, SEVERITY_SCORE[item.severity]), 0)
}

export function sortHousekeepingRooms(rooms: HousekeepingOperationalRoom[]): HousekeepingOperationalRoom[] {
  return [...rooms].sort((left, right) => {
    const attentionDifference = attentionScore(right) - attentionScore(left)
    if (attentionDifference !== 0) return attentionDifference
    const priorityDifference = (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    if (priorityDifference !== 0) return priorityDifference
    const floorDifference = (left.floor ?? Number.MAX_SAFE_INTEGER) - (right.floor ?? Number.MAX_SAFE_INTEGER)
    if (floorDifference !== 0) return floorDifference
    return left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true })
  })
}
