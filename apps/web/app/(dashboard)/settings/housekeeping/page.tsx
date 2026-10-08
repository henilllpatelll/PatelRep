'use client'

import { Suspense } from 'react'
import { HousekeepingSettings } from '@/components/settings/housekeeping/HousekeepingSettings'

export default function HousekeepingSettingsPage() {
  return (
    <Suspense fallback={null}>
      <HousekeepingSettings />
    </Suspense>
  )
}
