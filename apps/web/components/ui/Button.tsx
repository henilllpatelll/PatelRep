'use client'

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import { motion, MotionProps } from 'framer-motion'

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'ai'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-accent text-white hover:opacity-90 shadow-[var(--shadow-sm)]',
  dark:        'bg-ink text-paper hover:bg-ink2 shadow-[var(--shadow-sm)]',
  outline:     'bg-surface border border-line text-ink2 hover:bg-surface-2 hover:text-ink',
  secondary:   'bg-accent-soft border border-accent-line text-accent hover:bg-[var(--accent-line)]/30',
  ghost:       'bg-transparent text-ink2 hover:bg-surface-2 hover:text-ink',
  destructive: 'bg-alert-soft border border-alert-line text-alert hover:bg-[var(--alert-line)]/30',
  ai:          'bg-ai-soft border border-ai-line text-ai hover:bg-[var(--ai-line)]/30',
}

interface ButtonProps extends MotionProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps> {
  variant?: ButtonVariant
  className?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-3.5 py-2 min-h-[36px] rounded-[var(--r-md)] text-sm font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  )
)
Button.displayName = 'Button'
