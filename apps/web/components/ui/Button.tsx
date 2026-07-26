'use client'

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import { motion, MotionProps } from 'framer-motion'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'ai'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-accent text-white hover:opacity-90 shadow-[var(--shadow-sm)]',
  dark:        'bg-ink text-paper hover:bg-ink2 shadow-[var(--shadow-sm)]',
  outline:     'bg-surface border border-line text-ink2 hover:bg-surface-2 hover:text-ink',
  secondary:   'bg-accent-soft border border-accent-line text-accent hover:bg-[var(--accent-line)]/30',
  ghost:       'bg-transparent text-ink2 hover:bg-surface-2 hover:text-ink',
  destructive: 'bg-alert-soft border border-alert-line text-alert hover:bg-[var(--alert-line)]/30',
  ai:          'bg-ai-soft border border-ai-line text-ai hover:bg-[var(--ai-line)]/30',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 py-1.5 text-[12.5px] gap-1.5',
  md: 'min-h-[36px] px-3.5 py-2 text-sm gap-2',
  lg: 'min-h-[44px] px-4 py-2.5 text-[15px] gap-2',
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
}

/** Matches the accent ring used across the app's own focus states (Header search, Input). */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-paper'

interface ButtonProps extends MotionProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  className?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...props }, ref) => {
    const isDisabled = disabled || loading
    return (
      <motion.button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        whileTap={isDisabled ? undefined : { scale: 0.97 }}
        className={cn(
          'inline-flex items-center justify-center rounded-[var(--r-md)] font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          SIZES[size],
          VARIANTS[variant],
          FOCUS_RING,
          className
        )}
        {...props}
      >
        <>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />}
          {children}
        </>
      </motion.button>
    )
  }
)
Button.displayName = 'Button'

interface IconButtonProps extends Omit<ButtonProps, 'aria-label' | 'children'> {
  'aria-label': string
  children?: React.ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', loading = false, className, children, disabled, ...props }, ref) => {
    const isDisabled = disabled || loading
    return (
      <motion.button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        whileTap={isDisabled ? undefined : { scale: 0.94 }}
        className={cn(
          'inline-flex items-center justify-center shrink-0 rounded-[var(--r-md)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
          ICON_SIZES[size],
          VARIANTS[variant],
          FOCUS_RING,
          className
        )}
        {...props}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : children}
      </motion.button>
    )
  }
)
IconButton.displayName = 'IconButton'
