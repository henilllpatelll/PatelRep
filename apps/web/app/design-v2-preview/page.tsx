import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DashboardPreview } from '@/components/design-v2/DashboardPreview'
import { isDesignV2PreviewEnabled } from '@/lib/design/designV2'

// Evaluated per request so a flag mismatch can never serve a cached preview.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Design V2 preview (sample data)',
  robots: { index: false, follow: false },
}

/** Design System V2 reference preview (sample data only). Not a product route: it 404s unless the
 *  build/server was started with NEXT_PUBLIC_DESIGN_V2_PREVIEW=true (and is not a production env),
 *  and it is linked from nowhere in the app. See docs/PATELREP_DESIGN_SYSTEM_V2.md. */
export default function DesignV2PreviewPage() {
  if (!isDesignV2PreviewEnabled()) notFound()
  return <DashboardPreview />
}
