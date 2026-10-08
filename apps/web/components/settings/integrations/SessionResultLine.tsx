import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { formatTimestamp, type SessionResult } from '@/lib/settings/integrations'
import { cn } from '@/lib/utils'

/**
 * One line describing what happened the last time an action ran *in this browser session*. Pending, success,
 * failure and "not run yet" are all distinct, and only the server's own message is shown (never a raw payload).
 */
export function SessionResultLine({
  label, okLabel, failLabel, result, pending, idle, note,
}: {
  /** Shown while pending / idle, e.g. "Connection test". */
  label: string
  okLabel: string
  failLabel: string
  result: SessionResult | null
  pending: boolean
  idle?: string
  note?: string
}) {
  if (pending) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-ink-2">
        <Loader2 size={14} className="animate-spin text-ink-3" aria-hidden="true" />
        <span><span className="font-medium">{label}:</span> in progress…</span>
      </p>
    )
  }
  if (!result) return idle ? <p className="text-[13px] text-ink-3"><span className="font-medium">{label}:</span> {idle}</p> : null
  const at = formatTimestamp(result.at)
  return (
    <p className={cn('flex items-start gap-2 text-[13px]', result.ok ? 'text-ink-2' : 'text-[var(--alert)]')} role={result.ok ? undefined : 'alert'}>
      {result.ok
        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--ready)]" aria-hidden="true" />
        : <XCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span>
        <span className="font-medium">{result.ok ? okLabel : failLabel}:</span> {result.message}
        {at && <span className="text-ink-3"> ({at}, this session)</span>}
        {result.ok && note && <span className="block text-ink-3">{note}</span>}
      </span>
    </p>
  )
}
