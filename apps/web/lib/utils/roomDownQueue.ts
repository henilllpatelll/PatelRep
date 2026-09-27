import type { RoomUnavailabilityPeriod } from '@/lib/api/rooms'

function timestamp(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : Number.POSITIVE_INFINITY
}

function isEmergency(period: RoomUnavailabilityPeriod): boolean {
  return period.work_orders?.priority === 'emergency'
}

function isUnassigned(period: RoomUnavailabilityPeriod): boolean {
  return !period.owner_id && !period.work_orders?.assigned_to
}

/**
 * Deterministic dispatch ordering for active room-down episodes. This only
 * expresses the operational rules; it intentionally does not infer priority.
 */
export function orderRoomDownPeriods(periods: RoomUnavailabilityPeriod[], now = new Date()): RoomUnavailabilityPeriod[] {
  return [...periods].sort((a, b) => {
    const comparisons = [
      Number(b.is_past_eta) - Number(a.is_past_eta),
      Number(isEmergency(b)) - Number(isEmergency(a)),
      Number(!b.expected_return_at) - Number(!a.expected_return_at),
      Number(isUnassigned(b)) - Number(isUnassigned(a)),
      Number(b.type === 'OUT_OF_ORDER') - Number(a.type === 'OUT_OF_ORDER'),
      timestamp(a.expected_return_at) - timestamp(b.expected_return_at),
      new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      a.id.localeCompare(b.id),
    ]
    return comparisons.find((comparison) => comparison !== 0) ?? 0
  })
}

export function formatDowntime(startedAt: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 60_000))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainingMinutes = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${remainingMinutes}m`
  return `${remainingMinutes}m`
}

export function totalDowntimeMinutes(periods: RoomUnavailabilityPeriod[], now = new Date()): number {
  return periods.reduce((total, period) => total + Math.max(0, Math.floor((now.getTime() - new Date(period.started_at).getTime()) / 60_000)), 0)
}

export function formatMinutesAsDowntime(minutes: number): string {
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainingMinutes = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${remainingMinutes}m`
  return `${remainingMinutes}m`
}
