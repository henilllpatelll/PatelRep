import type { Shift } from '@/lib/api/scheduling'

export function sortOperationalShifts(shifts: Shift[]): Shift[] {
  return [...shifts].sort((left, right) => left.start_time.localeCompare(right.start_time))
}

function minutesSinceMidnight(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function isShiftActive(shift: Shift, now: Date): boolean {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const start = minutesSinceMidnight(shift.start_time)
  const end = minutesSinceMidnight(shift.end_time)

  if (start === end) return true
  if (end > start) return nowMinutes >= start && nowMinutes < end
  return nowMinutes >= start || nowMinutes < end
}

/** Selects the active shift first, then the latest shift already ended today. */
export function getRelevantShift(shifts: Shift[], now = new Date()): Shift | null {
  const ordered = sortOperationalShifts(shifts)
  if (!ordered.length) return null

  const active = ordered.find((shift) => isShiftActive(shift, now))
  if (active) return active

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const ended = ordered.filter((shift) => {
    const start = minutesSinceMidnight(shift.start_time)
    const end = minutesSinceMidnight(shift.end_time)
    return end > start && end <= nowMinutes
  })

  return ended.at(-1) ?? ordered[0]
}

export function getNextShift(shifts: Shift[], selectedShiftId: string | null): Shift | null {
  if (!selectedShiftId) return null
  const ordered = sortOperationalShifts(shifts)
  const index = ordered.findIndex((shift) => shift.id === selectedShiftId)
  if (index < 0 || ordered.length < 2) return null
  return ordered[(index + 1) % ordered.length]
}

export function formatShiftTime(time: string, locale?: string): string {
  const [hours = '0', minutes = '0'] = time.split(':')
  const date = new Date(2000, 0, 1, Number(hours), Number(minutes))
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}
