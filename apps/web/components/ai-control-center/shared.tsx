'use client'

import type { ReactNode } from 'react'
import { SettingsStatusPill, type StatusPillTone } from '@/components/settings/workspace/SettingsStatusPill'
import type { Tone } from '@/lib/aiControlCenter/model'
import { refusalMessage } from '@/lib/aiControlCenter/model'

const PILL: Record<Tone, StatusPillTone> = { good: 'ready', warn: 'caution', bad: 'alert', neutral: 'neutral' }

export function TonePill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <SettingsStatusPill tone={PILL[tone]}>{children}</SettingsStatusPill>
}

export function OnOff({ on, onLabel = 'On', offLabel = 'Off', danger = false }: {
  on: boolean; onLabel?: string; offLabel?: string; danger?: boolean
}) {
  return <TonePill tone={on ? (danger ? 'bad' : 'good') : 'neutral'}>{on ? onLabel : offLabel}</TonePill>
}

/** Error message for a failed request: stable reason code first, then the server's text, then a fallback. */
export function errorText(err: unknown, fallback: string): string {
  const code = (err as { code?: string | null } | null)?.code ?? null
  if (code) return refusalMessage(code, fallback)
  return err instanceof Error && err.message ? err.message : fallback
}

const BANNER = {
  alert: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]',
  info: 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]',
  caution: 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]',
} as const

export function Banner({ tone = 'alert', children }: { tone?: keyof typeof BANNER; children: ReactNode }) {
  return (
    <p role={tone === 'alert' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-[13px] ${BANNER[tone]}`}>
      {children}
    </p>
  )
}

export function Facts({ rows }: { rows: Array<{ label: string; value: ReactNode; hint?: string }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{row.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{row.value}</dd>
          {row.hint && <p className="mt-0.5 text-xs text-ink-3">{row.hint}</p>}
        </div>
      ))}
    </dl>
  )
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function Count({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-[var(--alert)]' : tone === 'warn' ? 'text-[var(--caution)]' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  )
}
