import { Suspense } from 'react'
import { GuestRequestsPage } from '@/components/guest-requests/GuestRequestsPage'

export default function Page() {
  return (
    <Suspense>
      <GuestRequestsPage />
    </Suspense>
  )
}
