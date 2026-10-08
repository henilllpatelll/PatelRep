'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hotelsApi, type HousekeepingSettings } from '@/lib/api/hotels'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useHotelStore } from '@/stores/hotelStore'

/** Hotel-scoped housekeeping configuration (workload + assignment preferences). The API scopes to the caller's hotel. */
export function useHousekeepingSettingsQuery() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  return useQuery({
    queryKey: ['housekeeping-settings', hotelId],
    queryFn: () => hotelsApi.getHousekeepingSettings(hotelId!),
    enabled: !!hotelId,
    select: (res) => res.data,
  })
}

/**
 * Saves only the given part of the settings. Each tab sends just its own fields so a save from one tab can
 * never overwrite what another tab owns with stale values.
 */
export function useSaveHousekeepingSettings() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<HousekeepingSettings>) => hotelsApi.updateHousekeepingSettings(hotelId!, payload),
    onSuccess: (result) => { queryClient.setQueryData(['housekeeping-settings', hotelId], result) },
  })
}

/** Active housekeepers eligible for a capacity override. */
export function useHousekeepers() {
  return useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    select: (res) => ((res.data.staff ?? []) as StaffMember[]).filter((member) => member.role === 'housekeeper'),
  })
}

export function useInvalidateChecklists() {
  const queryClient = useQueryClient()
  return useCallback(() => queryClient.invalidateQueries({ queryKey: ['cleaning-checklists'] }), [queryClient])
}
