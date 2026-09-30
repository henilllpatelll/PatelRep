'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { housekeepingApi, type PriorityReason } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const REASONS: PriorityReason[] = ['early_arrival', 'vip', 'guest_waiting', 'front_desk_request', 'operational_priority', 'other']

interface Props {
  roomId: string
  roomNumber: string
  isRush: boolean
  currentReason: string | null
  currentNeededBy: string | null
  currentNote: string | null
  open: boolean
  onClose: () => void
}

/** Manual Rush override -- distinct from the AI arrival-risk prediction (spec: "priority vs readiness risk"). */
export function RoomPrioritySheet({ roomId, roomNumber, isRush, currentReason, currentNeededBy, currentNote, open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [state, setState] = useState<'normal' | 'rush'>(isRush ? 'rush' : 'normal')
  const [reason, setReason] = useState<PriorityReason>((currentReason as PriorityReason) ?? 'early_arrival')
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setState(isRush ? 'rush' : 'normal')
    setReason((currentReason as PriorityReason) ?? 'early_arrival')
    setNeededBy(currentNeededBy ? new Date(currentNeededBy).toISOString().slice(11, 16) : '')
    setNote(currentNote ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomId])

  useModalFocusTrap(sheetRef, open, onClose)

  async function handleConfirm() {
    setLoading(true)
    try {
      const neededByIso = neededBy
        ? (() => { const d = new Date(); const [h, m] = neededBy.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString() })()
        : undefined
      await housekeepingApi.setRoomPriority(roomId, {
        priority_state: state,
        reason: state === 'rush' ? reason : undefined,
        needed_by: state === 'rush' ? neededByIso : undefined,
        note: state === 'rush' ? (note.trim() || undefined) : undefined,
      })
      toast.success(state === 'rush' ? t('housekeeping.roomDetail.priority.setToast', { roomNumber }) : t('housekeeping.roomDetail.priority.clearedToast', { roomNumber }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.priority.error'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="room-priority-title" onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} className="relative flex max-h-[88%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="room-priority-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.priority.title')}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{t('housekeeping.roomDetail.roomLabel', { roomNumber })}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 rounded-lg p-1.5" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4 text-ink3" /></Button>
        </div>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.priority.stateLabel')}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.priority.stateLabel')}</p>
          <div className="flex gap-2">
            {(['normal', 'rush'] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={state === option} onClick={() => setState(option)}
                className={`h-10 flex-1 rounded-lg border px-3 text-[13.5px] font-medium transition-colors ${state === option ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink hover:border-ink-4'}`}>
                {t(`housekeeping.roomDetail.priority.state.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {state === 'rush' && (
          <>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.priority.reasonLabel')}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.priority.reasonLabel')}</p>
              <div className="flex flex-col gap-1.5">
                {REASONS.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${reason === r ? 'border-ink bg-surface-2 font-medium text-ink' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}>
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${reason === r ? 'border-ink bg-ink' : 'border-ink-4'}`} aria-hidden="true" />
                    {t(`housekeeping.roomDetail.priority.reason.${r}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="room-priority-needed-by" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.priority.neededByLabel')}</label>
              <input id="room-priority-needed-by" type="time" value={neededBy} onChange={(e) => setNeededBy(e.target.value)}
                className="h-10 w-[140px] rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="room-priority-note" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.priority.noteLabel')}</label>
              <textarea id="room-priority-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder={t('housekeeping.roomDetail.priority.notePlaceholder')}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={loading} onClick={handleConfirm}>
            {t(state === 'rush' ? 'housekeeping.roomDetail.priority.confirmRush' : isRush ? 'housekeeping.roomDetail.priority.confirmClear' : 'housekeeping.roomDetail.priority.confirmSave')}
          </Button>
        </div>
      </div>
    </div>
  )
}
