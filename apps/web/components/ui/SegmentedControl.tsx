'use client'

import { cn } from '@/lib/utils'
import { motion, useReducedMotion } from 'framer-motion'
import { useId } from 'react'

export interface SegmentOption<T extends string = string> {
  value: T
  label: string
  count?: number
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  size?: 'sm' | 'md'
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: SegmentedControlProps<T>) {
  const layoutGroup = useId()
  const reducedMotion = useReducedMotion()

  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[var(--r-md)] border border-line bg-surface-3 p-0.5',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative whitespace-nowrap rounded-[calc(var(--r-md)-3px)] font-medium transition-colors duration-base ease-out-soft',
              size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]',
              active ? 'text-ink' : 'text-ink3 hover:text-ink2'
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-thumb-${layoutGroup}`}
                transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[calc(var(--r-md)-3px)] bg-surface shadow-[var(--shadow-sm)]"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {option.label}
              {option.count != null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px font-mono text-[10px]',
                    active ? 'bg-accent-soft text-accent' : 'bg-surface text-ink3'
                  )}
                >
                  {option.count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
