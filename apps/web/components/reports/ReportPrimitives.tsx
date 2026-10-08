'use client'

import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Pill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { AVAILABILITY_TEXT, type Availability } from '@/lib/reports/format'
import { printHides, type PrintPart } from '@/lib/reports/printOptions'
import { useReports } from './ReportsContext'

/**
 * Pill for Reports. The shared caution tone (amber text on a pale amber fill) measures 4.08:1, below WCAG AA
 * for small text, so Reports renders caution pills with ink text on the same fill.
 */
export function ReportPill({ className, ...props }: ComponentProps<typeof Pill>) {
  return <Pill {...props} className={cn(props.tone === 'caution' && '!text-ink', className)} />
}

/** Section card with a heading, optional description/actions. Uses real heading semantics. */
export function ReportSection({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
  printPart,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  headingLevel?: 2 | 3
  /** Which print option controls this section; it is not rendered while printing with that option off. */
  printPart?: PrintPart
}) {
  const { printOptions } = useReports()
  if (printPart && printHides(printOptions, printPart)) return null
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Card hover={false} className={cn('report-avoid-break p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading className="text-[14px] font-semibold text-ink">{title}</Heading>
          {description && <p className="mt-0.5 text-[12.5px] leading-snug text-ink3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </Card>
  )
}

/** Click/focus/hover explanation for a metric. Keyboard accessible; text is also exposed to screen readers. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="relative inline-flex print:hidden">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}
        className="rounded-full p-0.5 text-ink3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-64 rounded-[var(--r-md)] border border-line bg-surface p-3 text-left text-[12px] font-normal leading-relaxed text-ink2 shadow-pop"
        >
          {children}
        </span>
      )}
    </span>
  )
}

export function LiveBadge() {
  return <Pill tone="info" size="sm">Live now</Pill>
}

export function LowSampleBadge({ n }: { n?: number | null }) {
  return (
    <ReportPill tone="caution" size="sm">
      {n !== null && n !== undefined ? `Low sample (n=${n})` : 'Low sample'}
    </ReportPill>
  )
}

const SEVERITY_TONE = { critical: 'alert', high: 'caution', medium: 'info', info: 'neutral' } as const
const SEVERITY_TEXT = { critical: 'Critical', high: 'High', medium: 'Medium', info: 'Info' } as const

export function SeverityPill({ severity }: { severity: keyof typeof SEVERITY_TONE }) {
  return <Pill tone={SEVERITY_TONE[severity]} size="sm">{SEVERITY_TEXT[severity]}</Pill>
}

export function LoadingBlock({ label = 'Loading report', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}…</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: Math.min(4, rows + 1) }, (_, i) => (
          <Skeleton key={i} variant="card" className="h-[116px]" />
        ))}
      </div>
      <Skeleton variant="card" className="h-56" />
    </div>
  )
}

export function SectionSkeleton({ height = 'h-40' }: { height?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading section…</span>
      <Skeleton variant="card" className={height} />
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-6 text-center">
      <AlertTriangle className="h-5 w-5 text-[var(--alert)]" aria-hidden="true" />
      <p className="text-[13px] font-medium text-ink">{message ?? 'This section could not be loaded.'}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 print:hidden"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}

export function EmptyBlock({ title, body, positive }: { title: string; body?: string; positive?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      {positive && <CheckCircle2 className="h-5 w-5 text-[var(--ready)]" aria-hidden="true" />}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {body && <p className="max-w-[420px] text-[12.5px] leading-relaxed text-ink3">{body}</p>}
    </div>
  )
}

/** Why a number is missing — always text, never an unexplained dash or a zero. */
export function AvailabilityNotice({
  availability,
  reason,
  className,
  label,
}: {
  availability: Exclude<Availability, 'available'>
  reason?: string | null
  className?: string
  /** Override the lead-in (pass null for a plain informational note). */
  label?: string | null
}) {
  const lead = label === undefined ? `${AVAILABILITY_TEXT[availability]}.` : label
  return (
    <div role="note" className={cn('flex items-start gap-2 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink2', className)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink3" aria-hidden="true" />
      <p>
        {lead && <span className="font-medium text-ink">{lead} </span>}
        {reason}
      </p>
    </div>
  )
}

/** Wrap a recharts figure with an accessible name + a text equivalent. */
export function ChartFrame({ label, summary, children, height = 240 }: { label: string; summary: string; children: ReactNode; height?: number }) {
  return (
    <figure className="report-avoid-break m-0" aria-label={label}>
      <div role="img" aria-label={`${label}. ${summary}`} style={{ height }} className="w-full min-w-0">
        {children}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}
