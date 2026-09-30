'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { housekeepingApi, type ServiceAttemptResult } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const RESULTS: ServiceAttemptResult[] = ['dnd_no_response', 'return_later', 'guest_answered', 'dnd_cleared', 'other']

interface Props {
  roomId: string
  roomNumber: string
  open: boolean
  onClose: () => void
}

/** Record Attempt -- a focused, timestamped log of one DND/service visit (spec section 11). */
export function ServiceAttemptForm({ roomId, roomNumber, open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [result, setResult] = useState<ServiceAttemptResult>('dnd_no_response')
  const [returnAt, setReturnAt] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setResult('dnd_no_response')
    setReturnAt('')
    setNote('')
  }, [open, roomId])

  useModalFocusTrap(sheetRef, open, onClose)

  const needsReturnAt = result === 'return_later'

  async function handleConfirm() {
    if (needsReturnAt && !returnAt) return
    setLoading(true)
    try {
      const returnAtIso = returnAt
        ? (() => { const d = new Date(); const [h, m] = returnAt.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString() })()
        : undefined
      await housekeepingApi.recordServiceAttempt(roomId, { result, return_at: returnAtIso, note: note.trim() || undefined })
      toast.success(t('housekeeping.roomDetail.attempt.successToast', { roomNumber }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-service-attempts', roomId] })
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.attempt.error'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="room-attempt-title" onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} className="relative flex max-h-[88%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="room-attempt-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.attempt.title')}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{t('housekeeping.roomDetail.roomLabel', { roomNumber })} · {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 rounded-lg p-1.5" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4 text-ink3" /></Button>
        </div>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.attempt.resultLabel')}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.attempt.resultLabel')}</p>
          <div className="flex flex-col gap-1.5">
            {RESULTS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={result === r} onClick={() => setResult(r)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${result === r ? 'border-ink bg-surface-2 font-medium text-ink' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}>
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${result === r ? 'border-ink bg-ink' : 'border-ink-4'}`} aria-hidden="true" />
                {t(`housekeeping.roomDetail.attempt.result.${r}`)}
              </button>
            ))}
          </div>
        </div>

        {needsReturnAt && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="room-attempt-return-at" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.attempt.returnAtLabel')} <span className="text-[var(--alert)]">*</span></label>
            <input id="room-attempt-return-at" type="time" autoFocus value={returnAt} onChange={(e) => setReturnAt(e.target.value)}
              className="h-10 w-[140px] rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="room-attempt-note" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.attempt.noteLabel')}</label>
          <textarea id="room-attempt-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder={t('housekeeping.roomDetail.attempt.notePlaceholder')}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={loading} disabled={needsReturnAt && !returnAt} onClick={handleConfirm}>{t('housekeeping.roomDetail.attempt.confirm')}</Button>
        </div>
      </div>
    </div>
  )
}
