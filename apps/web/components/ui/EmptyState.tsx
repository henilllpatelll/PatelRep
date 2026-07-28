import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2.5 py-12 px-6 text-center', className)}>
      {icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-ink3">
          {icon}
        </div>
      )}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {body && <p className="max-w-[360px] text-[13px] leading-relaxed text-ink3">{body}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
