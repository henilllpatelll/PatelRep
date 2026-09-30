import { getRoomCardPresentation, normalizeHousekeepingRoom, type HousekeepingOperationalRoom, type RoomCardStatusKey } from './roomState'

export type RoomDetailFactKey = 'arrival' | 'checkout' | 'assigned' | 'started' | 'elapsed' | 'cleanedBy' | 'completed' | 'inspection'
export type RoomDetailPrimaryAction = 'assign' | 'startCleaning' | 'completeCleaning' | 'inspect' | 'markReady' | 'requestCleaning' | 'returnToCleaning' | null

export interface RoomDetailPresentation {
  statusKey: RoomCardStatusKey
  contextKey: ReturnType<typeof getRoomCardPresentation>['contextKey']
  showArrivalRisk: boolean
  riskFactorKeys: Array<'unassigned' | 'vip' | 'tightTurnaround' | 'cleaningOverdue' | 'arrivalApproaching'>
  factKeys: RoomDetailFactKey[]
  primaryAction: RoomDetailPrimaryAction
}

function hasSupportedRiskFactor(room: HousekeepingOperationalRoom, factor: string): boolean {
  const normalized = factor.trim().toLowerCase().replace(/[\s-]+/g, '_')
  switch (normalized) {
    case 'unassigned':
    case 'currently_unassigned':
      return room.assignmentState === 'unassigned'
    case 'vip':
    case 'vip_room':
      return room.isVip
    case 'tight_turnaround':
    case 'short_turnaround':
      return Boolean(room.checkinTime && room.checkoutTime)
    case 'cleaning_overdue':
    case 'cleaning_running_long':
      return room.housekeepingStatus === 'IN_PROGRESS'
    case 'arrival_approaching':
      return Boolean(room.checkinTime)
    default:
      return false
  }
}

/**
 * Maps the existing board contract to the small number of facts the drawer
 * needs to put above the fold. It intentionally returns keys, not copy, so
 * the room workspace stays fully localized by its caller.
 */
export function getRoomDetailPresentation(raw: unknown, options: {
  canSupervise: boolean
  canAssignOccupiedClean: boolean
}): RoomDetailPresentation {
  const room = normalizeHousekeepingRoom(raw)
  const card = getRoomCardPresentation(room)
  const source = room.source
  const predictionFactors = Array.isArray(source.prediction?.risk_factors)
    ? source.prediction.risk_factors.filter((factor: unknown): factor is string => typeof factor === 'string')
    : []
  const factorMap: Array<[string, RoomDetailPresentation['riskFactorKeys'][number]]> = [
    ['unassigned', 'unassigned'],
    ['currently_unassigned', 'unassigned'],
    ['vip', 'vip'],
    ['vip_room', 'vip'],
    ['tight_turnaround', 'tightTurnaround'],
    ['short_turnaround', 'tightTurnaround'],
    ['cleaning_overdue', 'cleaningOverdue'],
    ['cleaning_running_long', 'cleaningOverdue'],
    ['arrival_approaching', 'arrivalApproaching'],
  ]
  const riskFactorKeys = factorMap
    .filter(([factor]) => predictionFactors.some((candidate: string) => candidate.trim().toLowerCase().replace(/[\s-]+/g, '_') === factor) && hasSupportedRiskFactor(room, factor))
    .map(([, key]) => key)
    .filter((key, index, values) => values.indexOf(key) === index)

  let factKeys: RoomDetailFactKey[]
  switch (card.statusKey) {
    case 'cleaning':
      factKeys = ['assigned', 'started', 'elapsed']
      break
    case 'inspect':
      factKeys = ['cleanedBy', 'completed', 'inspection']
      break
    case 'ready':
      factKeys = ['arrival', 'cleanedBy', 'inspection']
      break
    default:
      factKeys = ['arrival', 'checkout', 'assigned']
  }

  let primaryAction: RoomDetailPrimaryAction = null
  if (room.housekeepingStatus === 'IN_PROGRESS') primaryAction = 'completeCleaning'
  else if (room.housekeepingStatus === 'CLEAN' && options.canSupervise) {
    primaryAction = room.inspectionRequired ? 'inspect' : 'markReady'
  }
  else if (room.housekeepingStatus === 'DIRTY' || room.housekeepingStatus === 'PICKUP') {
    primaryAction = room.assignmentState === 'unassigned'
      ? (options.canSupervise ? 'assign' : null)
      : 'startCleaning'
  } else if (room.housekeepingStatus === 'OCCUPIED') primaryAction = options.canAssignOccupiedClean ? 'assign' : 'requestCleaning'
  else if (['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.housekeepingStatus) && options.canSupervise) primaryAction = 'returnToCleaning'

  return {
    statusKey: card.statusKey,
    contextKey: card.contextKey,
    showArrivalRisk: (room.predictionRisk === 'HIGH' || room.predictionRisk === 'MEDIUM') && Boolean(room.predictedReadyAt || room.checkinTime),
    riskFactorKeys,
    factKeys,
    primaryAction,
  }
}
