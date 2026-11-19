import { Suspense } from 'react'
import { AiControlCenter } from '@/components/ai-control-center/AiControlCenter'

export default function AiControlCenterPage() {
  return (
    <Suspense fallback={null}>
      <AiControlCenter />
    </Suspense>
  )
}
