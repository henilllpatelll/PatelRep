import { cn } from '@/lib/utils'

export type StatusPillTone = 'ready' | 'info' | 'caution' | 'alert' | 'neutral'

const TONES: Record<StatusPillTone, { pill: string; dot: string }> = {
  ready: { pill: 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]', dot: 'bg-[var(--ready)]' },
  info: { pill: 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]', dot: 'bg-[var(--info)]' },
  caution: { pill: 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]', dot: 'bg-[var(--caution)]' },
  alert: { pill: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]', dot: 'bg-[var(--alert)]' },
  neutral: { pill: 'border-line bg-surface-2 text-ink-2', dot: 'bg-ink-3' },
}

/** Status label with a dot. The text always carries the meaning; colour is only reinforcement. */
export function SettingsStatusPill({ tone, children, className }: { tone: StatusPillTone; children: React.ReactNode; className?: string }) {
  const t = TONES[tone]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold', t.pill, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} aria-hidden="true" />
      {children}
    </span>
  )
}
