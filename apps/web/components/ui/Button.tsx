import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:     'bg-gradient-to-r from-indigo-400 to-indigo-600 text-white shadow-sm shadow-indigo-200 hover:from-indigo-500 hover:to-indigo-700',
  secondary:   'bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100',
  ghost:       'bg-white/70 border border-white/90 backdrop-blur-sm text-slate-600 hover:bg-white/90',
  destructive: 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
)
Button.displayName = 'Button'
