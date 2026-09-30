'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { housekeepingApi, type ServiceDeclinedReason } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const REASONS: ServiceDeclinedReason[] = ['guest_declined_housekeeping', 'guest_no_service_today', 'privacy_request', 'other']

interface Props {
  roomId: string
  roomNumber: string
  open: boolean
  onClose: () => void
}

/** Deliberate Service Declined -- distinct from housekeeper turning the room's
 * flag off/on (spec section 13): captures why, and the room keeps showing as
 * an exception rather than silently becoming Ready. */
export function RoomServiceStatusSheet({ roomId, roomNumber, open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [reason, setReason] = useState<ServiceDeclinedReason>('guest_declined_housekeeping')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason('guest_declined_housekeeping')
    setNote('')
  }, [open, roomId])

  useModalFocusTrap(sheetRef, open, onClose)

  async function handleConfirm() {
    setLoading(true)
    try {
      await housekeepingApi.setServiceDeclined(roomId, { reason, note: note.trim() || undefined })
      toast.success(t('housekeeping.roomDetail.serviceDeclined.successToast', { roomNumber }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.serviceDeclined.error'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="room-service-declined-title" onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} className="relative flex max-h-[88%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="room-service-declined-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.serviceDeclined.title')}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{t('housekeeping.roomDetail.roomLabel', { roomNumber })}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 rounded-lg p-1.5" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4 text-ink3" /></Button>
        </div>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.serviceDeclined.reasonLabel')}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.serviceDeclined.reasonLabel')}</p>
          <div className="flex flex-col gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${reason === r ? 'border-ink bg-surface-2 font-medium text-ink' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}>
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${reason === r ? 'border-ink bg-ink' : 'border-ink-4'}`} aria-hidden="true" />
                {t(`housekeeping.roomDetail.serviceDeclined.reason.${r}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="room-service-declined-note" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.serviceDeclined.noteLabel')}</label>
          <textarea id="room-service-declined-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder={t('housekeeping.roomDetail.serviceDeclined.notePlaceholder')}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={loading} onClick={handleConfirm}>{t('housekeeping.roomDetail.serviceDeclined.confirm')}</Button>
        </div>
      </div>
    </div>
  )
}
