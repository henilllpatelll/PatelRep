/**
 * Property Profile form model. Kept pure so persistence rules (ADR in cents, no room_count write)
 * are unit tested. Room count is NOT part of the form: the real count comes from the rooms table.
 */
import { z } from 'zod'
import type { HotelResponse, UpdateHotelData } from '@/lib/api/hotels'

export const US_TIMEZONES = [
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
] as const

export const propertyProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  address: z.string().trim().min(5, 'Street address is required'),
  city: z.string().trim().min(2, 'City is required'),
  state: z.string().trim().length(2, 'Use a 2-letter state code (e.g. TX)'),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  phone: z.string().trim().regex(/^\+?[\d\s\-().]{7,20}$/, 'Enter a valid phone number'),
  timezone: z.string().min(1, 'Timezone is required'),
  average_daily_rate: z
    .number({ error: 'Enter a dollar amount' })
    .min(0, 'Must be 0 or more')
    .max(100000, 'Max $100,000')
    .optional(),
})

export type PropertyProfileValues = z.infer<typeof propertyProfileSchema>
type Hotel = HotelResponse['data']['hotel']

export const EMPTY_PROFILE: PropertyProfileValues = {
  name: '', address: '', city: '', state: '', zip: '', phone: '', timezone: 'America/Chicago', average_daily_rate: undefined,
}

export function toFormValues(hotel: Hotel): PropertyProfileValues {
  return {
    name: hotel.name ?? '',
    address: hotel.address ?? '',
    city: hotel.city ?? '',
    state: hotel.state ?? '',
    zip: hotel.zip ?? '',
    phone: hotel.phone ?? '',
    timezone: hotel.timezone ?? 'America/Chicago',
    average_daily_rate: hotel.average_daily_rate_cents != null ? hotel.average_daily_rate_cents / 100 : undefined,
  }
}

/** PATCH body. ADR is sent as cents, or explicit null to clear it; `room_count` is never sent. */
export function toUpdatePayload(values: PropertyProfileValues): UpdateHotelData {
  return {
    name: values.name.trim(),
    address: values.address.trim(),
    city: values.city.trim(),
    state: values.state.trim().toUpperCase(),
    zip: values.zip.trim(),
    phone: values.phone.trim(),
    timezone: values.timezone,
    average_daily_rate_cents:
      values.average_daily_rate != null && !Number.isNaN(values.average_daily_rate)
        ? Math.round(values.average_daily_rate * 100)
        : null,
  }
}

/** The saved timezone may not be a US zone we list; keep it selectable so saving never rewrites it. */
export function timezoneOptions(current: string | undefined) {
  const base: { value: string; label: string }[] = [...US_TIMEZONES]
  if (current && !base.some((o) => o.value === current)) base.push({ value: current, label: current.replace(/_/g, ' ') })
  return base
}

export function formatTimezoneNow(timezone: string, now: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(now)
  } catch {
    return null
  }
}
