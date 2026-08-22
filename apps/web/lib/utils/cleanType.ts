export type CleanType = 'DEP' | 'FULL' | 'LIGHT'

export const CLEAN_TYPE_LABELS: Record<CleanType, string> = {
  DEP: 'Departure Clean',
  FULL: 'Full Linen Change',
  LIGHT: 'Light Service',
}

export const CLEAN_TYPE_SHORT_LABELS: Record<CleanType, string> = {
  DEP: 'Departure',
  FULL: 'Full',
  LIGHT: 'Light',
}

export const CLEAN_TYPE_OPTIONS: Array<{ value: CleanType; label: string; hint: string }> = [
  { value: 'DEP', label: 'Departure Clean', hint: 'Checkout room' },
  { value: 'FULL', label: 'Full Cleaning', hint: 'Stayover with linen change' },
  { value: 'LIGHT', label: 'Light Cleaning', hint: 'Stayover pickup' },
]

/**
 * Relative workload weight per clean type, used to balance assign-mode roster
 * load bars. Not tied to AI usage credits (see middleware/credits.py) — this is
 * a client-side-only workload unit with no backend field.
 */
export const CLEAN_TYPE_CREDITS: Record<CleanType, number> = {
  DEP: 3,
  FULL: 2,
  LIGHT: 1,
}

export function getCleanTypeCredits(cleanType?: string | null): number {
  if (!cleanType) return 0
  return CLEAN_TYPE_CREDITS[cleanType as CleanType] ?? 0
}

/** Statuses that still need a housekeeper's attention — excludes rooms already inspected, OOO, or handed off for inspection. */
const OPEN_HOUSEKEEPING_STATUSES = new Set(['DIRTY', 'PICKUP', 'OCCUPIED', 'IN_PROGRESS'])

export function isOpenHousekeepingRoom(room: { status?: string | null } | null | undefined): boolean {
  return !!room?.status && OPEN_HOUSEKEEPING_STATUSES.has(room.status)
}

export function getCleanTypeLabel(cleanType?: string | null): string | null {
  if (!cleanType) return null
  return CLEAN_TYPE_LABELS[cleanType as CleanType] ?? cleanType
}

export function getCleanTypeShortLabel(cleanType?: string | null): string | null {
  if (!cleanType) return null
  return CLEAN_TYPE_SHORT_LABELS[cleanType as CleanType] ?? cleanType
}

export function getCleanAwareStatusLabel(
  statusLabel: string,
  cleanType?: string | null,
  status?: string | null,
): string {
  const cleanTypeLabel = getCleanTypeShortLabel(cleanType)
  if (!cleanTypeLabel) return statusLabel

  if (status === 'PICKUP' && (cleanType === 'FULL' || cleanType === 'LIGHT')) {
    return `${statusLabel} - ${cleanTypeLabel}`
  }

  return statusLabel
}

export function getRoomStatusForCleanType(cleanType?: string | null): 'DIRTY' | 'PICKUP' {
  return cleanType === 'FULL' || cleanType === 'LIGHT' ? 'PICKUP' : 'DIRTY'
}

export function getEffectiveRoomStatusForCleanType(
  status?: string | null,
  cleanType?: string | null,
  foStatus?: string | null,
): string | null | undefined {
  if (cleanType === 'DEP' && foStatus === 'OCC') return 'OCCUPIED'
  if ((cleanType === 'FULL' || cleanType === 'LIGHT') && (status === 'DIRTY' || status === 'PICKUP' || status === 'OCCUPIED')) {
    return 'PICKUP'
  }
  if ((status !== 'DIRTY' && status !== 'PICKUP') || !cleanType) return status
  return getRoomStatusForCleanType(cleanType)
}
