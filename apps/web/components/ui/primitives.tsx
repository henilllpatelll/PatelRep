import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// ── Pill ─────────────────────────────────────────────────────────────────────
type PillTone =
  | 'neutral' | 'dirty' | 'progress' | 'clean' | 'inspected'
  | 'pickup' | 'ooo' | 'accent' | 'ai' | 'alert' | 'caution' | 'info' | 'ready'

const PILL_CLASSES: Record<PillTone, string> = {
  neutral:   'bg-surface-3 text-ink-2 border-line',
  dirty:     'bg-[var(--alert-soft)] text-[var(--alert)] border-[var(--alert-line)]',
  progress:  'bg-[var(--alert-soft)] text-[var(--alert)] border-[var(--alert-line)]',
  clean:     'bg-[var(--info-soft)] text-[var(--info)] border-[var(--info-line)]',
  inspected: 'bg-[var(--ready-soft)] text-[var(--ready)] border-[var(--ready-line)]',
  ready:     'bg-[var(--ready-soft)] text-[var(--ready)] border-[var(--ready-line)]',
  pickup:    'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]',
  ooo:       'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]',
  accent:    'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]',
  ai:        'bg-[var(--ai-soft)] text-[var(--ai)] border-[var(--ai-line)]',
  alert:     'bg-[var(--alert-soft)] text-[var(--alert)] border-[var(--alert-line)]',
  caution:   'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]',
  info:      'bg-[var(--info-soft)] text-[var(--info)] border-[var(--info-line)]',
}

interface PillProps {
  tone?: PillTone
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
  striped?: boolean
}

export function Pill({ tone = 'neutral', size = 'md', children, className, striped }: PillProps) {
  const sizeClass = size === 'sm'
    ? 'px-[7px] py-px text-[10.5px]'
    : size === 'lg'
    ? 'px-3 py-[5px] text-[12.5px]'
    : 'px-[9px] py-[3px] text-[11.5px]'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap leading-[14px]',
        PILL_CLASSES[tone],
        sizeClass,
        striped && 'bg-none',
        className
      )}
      style={striped ? {
        background: `repeating-linear-gradient(135deg, var(--alert-soft) 0 5px, color-mix(in srgb, var(--alert) 22%, white) 5px 10px)`,
      } : undefined}
    >
      {children}
    </span>
  )
}

// ── StatusDot ────────────────────────────────────────────────────────────────
const DOT_COLORS: Record<string, string> = {
  neutral:   'var(--ink-3)',
  dirty:     'var(--alert)',
  progress:  'var(--alert)',
  clean:     'var(--info)',
  inspected: 'var(--ready)',
  ready:     'var(--ready)',
  pickup:    'var(--caution)',
  ooo:       'var(--accent)',
  accent:    'var(--accent)',
  ai:        'var(--ai)',
}

export function StatusDot({ tone = 'neutral', size = 8 }: { tone?: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: DOT_COLORS[tone] ?? DOT_COLORS.neutral }}
    />
  )
}

// ── AILabel ──────────────────────────────────────────────────────────────────
interface AILabelProps {
  children?: ReactNode
  confidence?: number
  className?: string
}

export function AILabel({ children = 'AI', confidence, className }: AILabelProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 bg-[var(--ai-soft)] text-[var(--ai)] border border-[var(--ai-line)]',
      'text-[10px] font-semibold uppercase tracking-[0.5px] px-[5px] py-[2px] rounded',
      className
    )}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
      </svg>
      {children}
      {confidence != null && (
        <span className="font-mono opacity-70">{confidence}%</span>
      )}
    </span>
  )
}

// ── Mono ─────────────────────────────────────────────────────────────────────
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {children}
    </span>
  )
}

// ── SectionLabel ─────────────────────────────────────────────────────────────
interface SectionLabelProps {
  children: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}

export function SectionLabel({ children, hint, action, className }: SectionLabelProps) {
  return (
    <div className={cn('flex items-baseline justify-between mb-2.5', className)}>
      <div className="flex items-baseline gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {children}
        </span>
        {hint && (
          <span className="text-[12px] font-mono text-ink4">{hint}</span>
        )}
      </div>
      {action}
    </div>
  )
}

// ── Bar ──────────────────────────────────────────────────────────────────────
type BarTone = 'accent' | 'ready' | 'caution' | 'alert' | 'info' | 'ai'

const BAR_COLORS: Record<BarTone, string> = {
  accent:  'var(--accent)',
  ready:   'var(--ready)',
  caution: 'var(--caution)',
  alert:   'var(--alert)',
  info:    'var(--info)',
  ai:      'var(--ai)',
}

interface BarProps {
  value: number
  max?: number
  tone?: BarTone
  height?: number
  className?: string
}

export function Bar({ value, max = 100, tone = 'accent', height = 4, className }: BarProps) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div
      className={cn('w-full bg-surface-3 overflow-hidden', className)}
      style={{ height, borderRadius: height / 2 }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: BAR_COLORS[tone],
          borderRadius: height / 2,
        }}
      />
    </div>
  )
}

// ── Stat ─────────────────────────────────────────────────────────────────────
interface StatProps {
  label: string
  value: ReactNode
  unit?: string
  delta?: string
  deltaTone?: PillTone
  hint?: string
  icon?: ReactNode
  className?: string
}

export function Stat({ label, value, unit, delta, deltaTone = 'ready', hint, icon, className }: StatProps) {
  return (
    <div className={cn(
      'bg-surface border border-line rounded-[var(--r-lg)] p-[14px_16px] flex flex-col gap-1.5 min-h-[96px]',
      className
    )}>
      <div className="flex justify-between items-start">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 leading-none">
          {label}
        </span>
        {icon && <span className="text-ink4">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[32px] leading-none text-ink font-normal">{value}</span>
        {unit && <span className="text-[12px] font-mono text-ink-3">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-auto">
        {delta && <Pill tone={deltaTone} size="sm">{delta}</Pill>}
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </div>
    </div>
  )
}
