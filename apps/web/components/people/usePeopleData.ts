'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { staffApi } from '@/lib/api/staff'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelToday } from '@/lib/people/peopleDirectory'

/** Every People query key carries the hotel id so a hotel switch can never show another hotel's data. */
export function usePeopleHotel() {
  const hotel = useHotelStore((s) => s.hotel)
  return { hotelId: hotel?.id ?? null, timezone: hotel?.timezone ?? null, today: hotelToday(hotel?.timezone) }
}

export const customRolesKey = (hotelId: string | null) => ['custom-roles', hotelId] as const
export const coverageKey = (hotelId: string | null, userId: string) => ['role-schedules', hotelId, userId] as const

export function useCustomRoles(enabled = true) {
  const { hotelId } = usePeopleHotel()
  return useQuery({
    queryKey: customRolesKey(hotelId),
    queryFn: () => staffApi.listCustomRoles(),
    select: (res) => res.data,
    enabled: enabled && !!hotelId,
    staleTime: 60_000,
  })
}

/** One request, only for the person whose drawer is open - never per directory row. */
export function useCoverage(userId: string, enabled = true) {
  const { hotelId } = usePeopleHotel()
  return useQuery({
    queryKey: coverageKey(hotelId, userId),
    queryFn: () => staffApi.getRoleSchedules(userId),
    select: (res) => res.data,
    enabled: enabled && !!hotelId,
  })
}

/** After any staff or invitation change: refresh the directory, its counts and today's roster. */
export function useRefreshPeople() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['staff'] }),
    qc.invalidateQueries({ queryKey: ['staff-invitations'] }),
    qc.invalidateQueries({ queryKey: ['people-today'] }),
    qc.invalidateQueries({ queryKey: ['role-schedules'] }),
  ])
}
