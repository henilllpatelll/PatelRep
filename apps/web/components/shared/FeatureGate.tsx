'use client'

import type { ReactNode } from 'react'
import { useHotelStore } from '@/stores/hotelStore'
import { isFeatureEnabled } from '@/lib/utils/featureFlag'

interface FeatureGateProps {
  feature: string
  children: ReactNode
  fallback?: ReactNode
}

/**
 * Children/fallback boundary for a tenant feature flag. For prop-style
 * gating (matching the existing redesigned={v2} convention), call
 * isFeatureEnabled() directly instead — this component is only for wrapping
 * a whole UI boundary. Not a RedesignGate rename: that component is unused
 * and specific to the web-redesign rollout, this is the general mechanism.
 */
export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const hotel = useHotelStore((state) => state.hotel)
  return <>{isFeatureEnabled(feature, hotel) ? children : fallback}</>
}
