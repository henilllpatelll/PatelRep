'use client'

import { StateBlock } from '@/components/ui/StateBlock'
import type { EmptyStateProps } from '@/components/ui/EmptyState'

/** Consistent loading / empty / error blocks for Settings panels (thin wrappers over StateBlock). */
export function SettingsLoading({ label = 'Loading…' }: { label?: string }) {
  return <StateBlock status="loading" loadingLabel={label} />
}

export function SettingsEmpty(props: EmptyStateProps) {
  return <StateBlock status="empty" empty={props} />
}

export function SettingsError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return <StateBlock status="error" error={{ message: message ?? 'Something went wrong loading this section.', onRetry }} />
}
