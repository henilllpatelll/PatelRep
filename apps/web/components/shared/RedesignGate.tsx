'use client'

import type { ReactNode } from 'react'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'

export function RedesignGate({ section, v2, legacy }: { section: string; v2: ReactNode; legacy: ReactNode }) {
  const hotel = useHotelStore((s) => s.hotel)
  return <>{isSectionRedesigned(section, hotel) ? v2 : legacy}</>
}
