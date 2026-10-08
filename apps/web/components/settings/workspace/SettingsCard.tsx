import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Plain white settings surface. Use the link tiles on Settings Home for navigable cards. */
export function SettingsCard({ children, className, as: Tag = 'section', ...rest }: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...rest} className={cn('rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-card', className)}>
      {children}
    </Tag>
  )
}
