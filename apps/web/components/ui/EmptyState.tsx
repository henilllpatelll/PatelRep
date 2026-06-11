import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  /** compact = inline list empty, default = full panel */
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'anim-fade flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6 bg-surface-2 border border-dashed border-line rounded-[var(--r-lg)]',
        className
      )}
    >
      {Icon && (
        <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-ink3">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-[14.5px] font-medium text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-[360px] text-[12.5px] leading-relaxed text-ink3">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
