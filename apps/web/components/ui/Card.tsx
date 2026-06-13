import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  /** Lift + stronger shadow on hover — for clickable cards */
  interactive?: boolean
  accent?: string
}

export function Card({ children, className, hover = true, interactive = false, accent }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-line rounded-[var(--r-lg)] shadow-card',
        interactive ? 'lift cursor-pointer' : hover && 'hover:shadow-card-hover transition-shadow duration-base ease-out-soft',
        accent && 'border-l-[3px]',
        className
      )}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      {children}
    </div>
  )
}
