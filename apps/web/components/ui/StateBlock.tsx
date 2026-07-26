'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { EmptyState, type EmptyStateProps } from './EmptyState'

interface StateBlockProps {
  /** Omit (or null) to render `children` — the "data present" state. */
  status?: 'loading' | 'empty' | 'error' | null
  loadingLabel?: string
  empty?: EmptyStateProps
  error?: { message?: string; onRetry?: () => void }
  className?: string
  children?: ReactNode
}

export function StateBlock({ status, loadingLabel, empty, error, className, children }: StateBlockProps) {
  const { t } = useTranslation()

  if (status === 'loading') {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-ink3', className)}>
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <p className="text-[13px]">{loadingLabel ?? t('common.loading')}</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2.5 py-12 px-6 text-center', className)}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--alert-soft)] text-[var(--alert)]">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-[14px] font-medium text-ink">{error?.message ?? t('common.error')}</p>
        {error?.onRetry && (
          <Button variant="outline" size="sm" onClick={error.onRetry} className="mt-1">
            {t('common.retry')}
          </Button>
        )}
      </div>
    )
  }

  if (status === 'empty') {
    return <EmptyState {...(empty ?? { title: t('common.noResults') })} className={cn(className, empty?.className)} />
  }

  return <>{children}</>
}
