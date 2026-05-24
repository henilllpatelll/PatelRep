import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

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
  return (
    <div className={cn('pb-0', className)}>
      <div className="flex justify-between items-end gap-6">
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3 mb-2">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-[34px] font-normal tracking-[-0.5px] leading-[1.1] text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[14px] text-ink2 max-w-[640px] leading-[1.45]">{subtitle}</p>
          )}
          {meta && (
            <div className="flex items-center gap-3.5 mt-3">{meta}</div>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 pb-1 shrink-0">{actions}</div>
        )}
      </div>

      {tabs && (
        <div className="flex mt-4 border-b border-line -mb-px">
          {tabs.map((tab, i) => (
            <button
              key={i}
              onClick={tab.onClick}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] border-b-2 transition-colors',
                tab.active
                  ? 'font-semibold text-ink border-accent'
                  : 'font-medium text-ink3 border-transparent hover:text-ink2'
              )}
            >
              {tab.label}
              {tab.count != null && (
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-px rounded-full',
                  tab.active
                    ? 'bg-[var(--accent-soft)] text-accent'
                    : 'bg-surface-3 text-ink3'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
