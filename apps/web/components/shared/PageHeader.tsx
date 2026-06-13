'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

interface Tab {
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
}

interface PageHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  meta?: ReactNode
  actions?: ReactNode
  tabs?: Tab[]
  className?: string
}

export function PageHeader({ eyebrow, title, subtitle, meta, actions, tabs, className }: PageHeaderProps) {
  const reducedMotion = useReducedMotion()

  return (
    <div className={cn('pb-0', className)}>
      <div className="flex justify-between items-end gap-6">
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <p className="anim-fade text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3 mb-2">
              {eyebrow}
            </p>
          )}
          <h1 className="anim-rise font-display text-[32px] md:text-[36px] font-normal tracking-[-0.6px] leading-[1.08] text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="anim-rise stagger-1 mt-2 text-[14px] text-ink2 max-w-[640px] leading-[1.45]">{subtitle}</p>
          )}
          {meta && (
            <div className="anim-rise stagger-2 flex items-center gap-3.5 mt-3">{meta}</div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 pb-1 shrink-0">{actions}</div>
        )}
      </div>

      {tabs && (
        <div className="flex mt-4 border-b border-line -mb-px overflow-x-auto">
          {tabs.map((tab, i) => (
            <button
              key={i}
              onClick={tab.onClick}
              role="tab"
              aria-selected={tab.active}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-[13px] whitespace-nowrap transition-colors duration-base ease-out-soft',
                tab.active
                  ? 'font-semibold text-ink'
                  : 'font-medium text-ink3 hover:text-ink2'
              )}
            >
              {tab.label}
              {tab.count != null && (
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-px rounded-full transition-colors duration-base',
                  tab.active
                    ? 'bg-[var(--accent-soft)] text-accent'
                    : 'bg-surface-3 text-ink3'
                )}>
                  {tab.count}
                </span>
              )}
              {tab.active && (
                <motion.span
                  layoutId="page-header-tab-underline"
                  transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }}
                  className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-accent"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
