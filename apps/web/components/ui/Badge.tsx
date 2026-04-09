import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant =
  | 'dirty' | 'in_progress' | 'clean' | 'inspected'
  | 'do_not_disturb' | 'out_of_order'
  | 'high' | 'medium' | 'low' | 'vip' | 'default'

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  dirty:          'bg-red-50 text-red-800 border-red-200',
  in_progress:    'bg-blue-50 text-blue-800 border-blue-200',
  clean:          'bg-amber-50 text-amber-800 border-amber-300',
  inspected:      'bg-green-50 text-green-800 border-green-200',
  do_not_disturb: 'bg-stone-100 text-stone-600 border-stone-200',
  out_of_order:   'bg-stone-200 text-stone-700 border-stone-300',
  high:           'bg-red-100 text-red-700 border-red-200',
  medium:         'bg-orange-100 text-orange-700 border-orange-200',
  low:            'bg-stone-100 text-stone-600 border-stone-200',
  vip:            'bg-amber-100 text-amber-800 border-amber-300',
  default:        'bg-stone-100 text-stone-600 border-stone-200',
}

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
        BADGE_VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
