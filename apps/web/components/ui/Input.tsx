import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-2 rounded-lg text-sm text-slate-900 placeholder:text-slate-400',
        'bg-white/70 border border-indigo-200/[0.40] backdrop-blur-sm',
        'focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400',
        'transition-colors duration-200',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
