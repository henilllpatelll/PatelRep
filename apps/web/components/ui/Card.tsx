import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
}

export function Card({ children, className, hover = true }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-stone-100 shadow-card',
        hover && 'hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200',
        className
      )}
    >
      {children}
    </div>
  )
}
