import { Suspense } from 'react'
import { RoomsSettings } from '@/components/settings/rooms/RoomsSettings'
import { SettingsLoading } from '@/components/settings/workspace/SettingsStates'

// useSearchParams (URL-backed tab, search and filters) requires a Suspense boundary at build time.
export default function RoomsAndAccessibilityPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <RoomsSettings />
    </Suspense>
  )
}
