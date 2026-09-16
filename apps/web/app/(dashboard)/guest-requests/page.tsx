'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Guest Requests merged into the unified Tasks screen — this route only exists to keep old
// bookmarks, notifications, and deep links (e.g. ?focus=<id>) working.
function GuestRequestsRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const focus = searchParams.get('focus')
    router.replace(focus ? `/tasks?view=guest&focus=${focus}` : '/tasks?view=guest')
  }, [router, searchParams])

  return null
}

export default function Page() {
  return (
    <Suspense>
      <GuestRequestsRedirect />
    </Suspense>
  )
}
