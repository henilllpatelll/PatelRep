'use client'

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import { motion, MotionProps, useReducedMotion } from 'framer-motion'

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'ai'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-accent text-white hover:bg-[var(--accent-hover)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]',
  dark:        'bg-ink text-paper hover:bg-ink2 shadow-[var(--shadow-sm)]',
  outline:     'bg-surface border border-line text-ink2 hover:bg-surface-2 hover:text-ink hover:border-ink4',
  secondary:   'bg-accent-soft border border-accent-line text-accent hover:bg-[var(--accent-line)]/30',
  ghost:       'bg-transparent text-ink2 hover:bg-surface-2 hover:text-ink',
  destructive: 'bg-alert-soft border border-alert-line text-alert hover:bg-[var(--alert-line)]/30',
  ai:          'bg-ai-soft border border-ai-line text-ai hover:bg-[var(--ai-line)]/30',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 min-h-[30px] text-[12.5px] gap-1.5 rounded-[var(--r-sm)]',
  md: 'px-3.5 py-2 min-h-[36px] text-sm gap-2 rounded-[var(--r-md)]',
  lg: 'px-5 py-2.5 min-h-[44px] text-[15px] gap-2 rounded-[var(--r-md)]',
}

interface ButtonProps extends MotionProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  className?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props }, ref) => {
    const reducedMotion = useReducedMotion()
    const inert = disabled || loading
    return (
      <motion.button
        ref={ref}
        disabled={inert}
        aria-busy={loading || undefined}
        whileTap={inert || reducedMotion ? undefined : { scale: 0.97 }}
        className={cn(
          'relative inline-flex items-center justify-center font-medium transition-[background-color,border-color,box-shadow,color] duration-base ease-out-soft cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          SIZES[size],
          VARIANTS[variant],
          className
        )}
        {...props}
      >
        {loading && (
          <span
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-80"
            style={{ animation: 'spin 0.7s linear infinite' }}
          />
        )}
        {children as React.ReactNode}
      </motion.button>
    )
  }
)
Button.displayName = 'Button'
