import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant =
  | 'dirty' | 'in_progress' | 'clean' | 'inspected'
  | 'do_not_disturb' | 'out_of_order' | 'out_of_service' | 'occupied' | 'pickup'
  | 'high' | 'medium' | 'low' | 'vip' | 'ai' | 'default'

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  dirty:          'bg-[var(--alert-soft)]   text-[var(--alert)]   border-[var(--alert-line)]',
  in_progress:    'bg-[var(--progress-soft)] text-[var(--progress)] border-[var(--progress-line)]',
  clean:          'bg-[var(--info-soft)]    text-[var(--info)]    border-[var(--info-line)]',
  inspected:      'bg-[var(--ready-soft)]   text-[var(--ready)]   border-[var(--ready-line)]',
  pickup:         'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]',
  do_not_disturb: 'bg-[var(--surface-3)]   text-[var(--ink-3)]   border-[var(--line)]',
  out_of_order:   'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]',
  out_of_service: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]',
  occupied:       'bg-[var(--alert-soft)]   text-[var(--alert)]   border-[var(--alert-line)]',
  high:           'bg-[var(--alert-soft)]   text-[var(--alert)]   border-[var(--alert-line)]',
  medium:         'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]',
  low:            'bg-[var(--ready-soft)]   text-[var(--ready)]   border-[var(--ready-line)]',
  vip:            'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]',
  ai:             'bg-[var(--ai-soft)]      text-[var(--ai)]      border-[var(--ai-line)]',
  default:        'bg-[var(--surface-3)]   text-[var(--ink-3)]   border-[var(--line)]',
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
        'inline-flex items-center rounded-full px-2 py-px text-xs font-medium border',
        BADGE_VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
