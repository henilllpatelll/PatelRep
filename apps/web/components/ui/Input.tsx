import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-800 placeholder:text-stone-300',
        'focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none',
        'disabled:opacity-50 disabled:bg-stone-100 disabled:cursor-not-allowed',
        'transition-colors duration-150',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
