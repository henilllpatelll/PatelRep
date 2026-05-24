import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  accent?: string
}

export function Card({ children, className, hover = true, accent }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-line rounded-[var(--r-lg)] shadow-card',
        hover && 'hover:shadow-card-hover transition-shadow duration-150',
        accent && 'border-l-[3px]',
        className
      )}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      {children}
    </div>
  )
}
