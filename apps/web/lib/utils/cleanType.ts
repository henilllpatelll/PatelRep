export type CleanType = 'DEP' | 'FULL' | 'LIGHT'

export const CLEAN_TYPE_LABELS: Record<CleanType, string> = {
  DEP: 'Departure Clean',
  FULL: 'Full Linen Change',
  LIGHT: 'Light Service',
}

export const CLEAN_TYPE_SHORT_LABELS: Record<CleanType, string> = {
  DEP: 'Departure',
  FULL: 'Full Linen',
  LIGHT: 'Light',
}

export const CLEAN_TYPE_OPTIONS: Array<{ value: CleanType; label: string; hint: string }> = [
  { value: 'DEP', label: 'Departure', hint: 'Checkout room' },
  { value: 'FULL', label: 'Full Linen', hint: 'Stayover with linen change' },
  { value: 'LIGHT', label: 'Light', hint: 'Stayover pickup' },
]

export function getCleanTypeLabel(cleanType?: string | null): string | null {
  if (!cleanType) return null
  return CLEAN_TYPE_LABELS[cleanType as CleanType] ?? cleanType
}

export function getCleanTypeShortLabel(cleanType?: string | null): string | null {
  if (!cleanType) return null
  return CLEAN_TYPE_SHORT_LABELS[cleanType as CleanType] ?? cleanType
}
