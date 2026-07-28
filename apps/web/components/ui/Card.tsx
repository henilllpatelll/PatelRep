import { cn } from '@/lib/utils'
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  hover?: boolean
  accent?: string
  onClick?: () => void
}

export function Card({ children, className, hover = true, accent, onClick, ...rest }: CardProps) {
  const handleKeyDown = onClick
    ? (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }
    : undefined

  return (
    <div
      {...rest}
      className={cn(
        'bg-surface border border-line rounded-[var(--r-lg)] shadow-card',
        hover && 'hover:shadow-card-hover transition-shadow duration-150',
        accent && 'border-l-[3px]',
        onClick && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 outline-none',
        className
      )}
      style={accent ? { borderLeftColor: accent } : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  )
}
