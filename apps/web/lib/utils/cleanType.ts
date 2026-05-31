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
