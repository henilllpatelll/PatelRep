import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'card' | 'room-card' | 'circle'
}

export function Skeleton({ className, variant = 'text' }: SkeletonProps) {
  const BASE = 'bg-stone-100 animate-pulse relative overflow-hidden rounded-xl'
  const AFTER = 'after:absolute after:inset-0 after:shimmer'

  const VARIANTS = {
    text:        'h-4 w-full',
    card:        'h-32 w-full rounded-2xl',
    'room-card': 'aspect-[4/3] w-full rounded-2xl',
    circle:      'rounded-full w-8 h-8',
  }

  return <div className={cn(BASE, AFTER, VARIANTS[variant], className)} />
}
