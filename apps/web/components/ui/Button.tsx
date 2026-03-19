'use client'

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import { motion, MotionProps } from 'framer-motion'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-md shadow-amber-200/60 hover:from-amber-500 hover:to-amber-600',
  secondary:   'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100',
  ghost:       'bg-white/70 border border-stone-200 text-stone-600 hover:bg-stone-50',
  destructive: 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100',
}

interface ButtonProps extends MotionProps {
  variant?: ButtonVariant
  className?: string
  disabled?: boolean
  children?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
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
