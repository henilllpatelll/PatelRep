'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHotelStore } from '@/stores/hotelStore'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { guestRequestsApi, type AccessibleRoomFeature } from '@/lib/api/guest_requests'
import { toRoomRows } from '@/lib/settings/rooms'

/** Hotel-scoped data for Rooms & Accessibility. All endpoints scope to the caller's hotel server-side. */
export function useRoomRows() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  return useQuery({
    queryKey: ['settings-rooms', hotelId],
    queryFn: () => roomsApi.list() as Promise<{ data: RoomStatus[] }>,
    enabled: !!hotelId,
    select: (res) => toRoomRows(res.data ?? []),
  })
}

export function useRoomTypes() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  return useQuery({
    queryKey: ['room-types', hotelId],
    queryFn: () => roomsApi.listTypes(),
    enabled: !!hotelId,
    select: (res) => res.data ?? [],
  })
}

export function useAccessibleFeatures() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  return useQuery({
    queryKey: ['accessible-room-features', hotelId],
    queryFn: () => guestRequestsApi.listAccessibleRoomFeatures(),
    enabled: !!hotelId,
    select: (res): AccessibleRoomFeature[] => res.data ?? [],
  })
}

/** Refresh everything that renders room master data after a mutation (incl. the property room count). */
export function useInvalidateRooms() {
  const queryClient = useQueryClient()
  return useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['settings-rooms'] }),
    queryClient.invalidateQueries({ queryKey: ['room-types'] }),
    queryClient.invalidateQueries({ queryKey: ['accessible-room-features'] }),
    queryClient.invalidateQueries({ queryKey: ['rooms'] }),
    queryClient.invalidateQueries({ queryKey: ['hotel-stats'] }),
    queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] }),
  ]), [queryClient])
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function errorStatus(err: unknown): number | null {
  const status = (err as { status?: number | null } | null)?.status
  return typeof status === 'number' ? status : null
}
