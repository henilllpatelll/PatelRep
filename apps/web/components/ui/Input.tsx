import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full min-h-[40px] bg-surface border border-line rounded-[var(--r-md)] px-3.5 py-2 text-sm text-ink placeholder:text-ink4',
        'hover:border-ink4',
        'focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none',
        'disabled:opacity-50 disabled:bg-surface-3 disabled:cursor-not-allowed',
        'transition-[border-color,box-shadow] duration-base ease-out-soft',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
