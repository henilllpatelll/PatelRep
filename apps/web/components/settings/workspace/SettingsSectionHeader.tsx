import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Heading block for a Settings page or section: title, one-line description, optional actions. */
export function SettingsSectionHeader({
  title, description, actions, level = 2, className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  level?: 1 | 2 | 3
  className?: string
}) {
  const Heading = (`h${level}` as 'h1' | 'h2' | 'h3')
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className={cn('font-semibold text-ink', level === 3 ? 'text-sm' : 'text-lg')}>{title}</Heading>
        {description && <p className="mt-1 max-w-prose text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
