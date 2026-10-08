'use client'

import { Suspense } from 'react'
import { RolesAccessSettings } from '@/components/settings/roles/RolesAccessSettings'

export default function RolesSettingsPage() {
  return (
    <Suspense fallback={null}>
      <RolesAccessSettings />
    </Suspense>
  )
}
