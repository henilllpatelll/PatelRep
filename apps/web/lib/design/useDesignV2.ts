'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { designV2ContextExpiresAt } from './designV2Activation'
import { isDesignV2Enabled } from './designV2'

/** Reactive version for the shell: re-renders when the user, hotel, flag or freshness changes, including exactly
 *  when a fresh-enough context expires (an offline tab drops back to the legacy design on its own). The decision
 *  itself is isDesignV2Enabled(), the one place that combines preview and tenant activation. */
export function useDesignV2(): boolean {
  // Subscribed only so this component re-renders when any input to the decision changes.
  useAuthStore((s) => s.user?.id)
  useHotelStore((s) => s.hotel)
  useHotelStore((s) => s.contextUserId)
  useHotelStore((s) => s.contextHotelId)
  const contextFetchedAt = useHotelStore((s) => s.contextFetchedAt)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (typeof contextFetchedAt !== 'number') return undefined
    const wait = designV2ContextExpiresAt(contextFetchedAt) - Date.now() + 50
    if (wait <= 0) return undefined
    // setTimeout caps at ~24.8 days; the max age is minutes, far below that.
    const timer = setTimeout(() => setTick((n) => n + 1), wait)
    return () => clearTimeout(timer)
  }, [contextFetchedAt])

  return isDesignV2Enabled()
}
