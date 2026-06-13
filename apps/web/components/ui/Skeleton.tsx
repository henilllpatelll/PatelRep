import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'card' | 'room-card' | 'circle' | 'row'
}

export function Skeleton({ className, variant = 'text' }: SkeletonProps) {
  const BASE = 'bg-surface-3 relative overflow-hidden'
  const AFTER = 'after:absolute after:inset-0 after:shimmer'

  const VARIANTS = {
    text:        'h-4 w-full rounded-md',
    card:        'h-32 w-full rounded-[var(--r-lg)]',
    'room-card': 'aspect-[4/3] w-full rounded-[var(--r-lg)]',
    circle:      'rounded-full w-8 h-8',
    row:         'h-12 w-full rounded-[var(--r-md)]',
  }

  return <div aria-hidden className={cn(BASE, AFTER, VARIANTS[variant], className)} />
}
