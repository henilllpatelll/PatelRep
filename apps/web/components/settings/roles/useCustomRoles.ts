'use client'

import { useQuery } from '@tanstack/react-query'
import { staffApi, type CustomRole } from '@/lib/api/staff'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'

/** A custom role plus how many active staff hold it (added by the API for the delete safeguard). */
export type CustomRoleRow = CustomRole & { assigned_staff_count?: number }

export function useCustomRoles() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const { isGM } = useRole()
  return useQuery({
    queryKey: ['custom-roles', hotelId],
    queryFn: () => staffApi.listCustomRoles(),
    enabled: !!hotelId && isGM,
    select: (res) => res.data as CustomRoleRow[],
  })
}
