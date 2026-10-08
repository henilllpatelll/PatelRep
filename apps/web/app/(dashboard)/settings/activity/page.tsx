import { Suspense } from 'react'
import { ActivitySettings } from '@/components/settings/activity/ActivitySettings'
import { SettingsLoading } from '@/components/settings/workspace/SettingsStates'

// useSearchParams() (filters live in the URL) must sit under a Suspense boundary for `next build`.
export default function ActivityAuditPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <ActivitySettings />
    </Suspense>
  )
}
