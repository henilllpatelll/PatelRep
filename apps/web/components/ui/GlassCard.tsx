import { cn } from '@/lib/utils'

type GlassVariant = 'default' | 'accent' | 'danger' | 'success' | 'elevated'

const VARIANTS: Record<GlassVariant, string> = {
  default:  'bg-white/[0.65] border-white/90 shadow-[0_2px_12px_rgba(99,102,241,0.05)]',
  accent:   'bg-indigo-400/[0.10] border-indigo-400/[0.22]',
  danger:   'bg-red-400/[0.08] border-red-400/[0.20]',
  success:  'bg-green-400/[0.10] border-green-400/[0.25]',
  elevated: 'bg-white/[0.88] border-white/[0.95]',
}

interface GlassCardProps {
  variant?: GlassVariant
  className?: string
  children: React.ReactNode
}

export function GlassCard({ variant = 'default', className, children }: GlassCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border backdrop-blur-md p-4',
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </div>
  )
}
