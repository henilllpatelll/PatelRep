'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { housekeepingApi, type DiscrepancyResolution, type OccupancyDiscrepancy, type OccupancyObservation } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const RESOLUTIONS: DiscrepancyResolution[] = ['pms_confirmed', 'housekeeping_confirmed', 'guest_record_corrected', 'false_alarm', 'escalated']

function pmsStatusLabel(status: string | null, t: (key: string) => string): string {
  if (status === 'OCC') return t('housekeeping.roomDetail.discrepancy.pmsOccupied')
  if (status === 'VAC') return t('housekeeping.roomDetail.discrepancy.pmsVacant')
  return t('housekeeping.roomDetail.discrepancy.pmsUnknown')
}

interface Props {
  roomId: string
  roomNumber: string
  pmsStatus: string | null
  openDiscrepancy: OccupancyDiscrepancy | null
  canResolve: boolean
  open: boolean
  onClose: () => void
}

/** Report (housekeeping) / Resolve (Front Desk) occupancy discrepancy -- never
 * writes PMS occupancy directly (spec sections 20/21/23). */
export function OccupancyDiscrepancySheet({ roomId, roomNumber, pmsStatus, openDiscrepancy, canResolve, open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [observed, setObserved] = useState<OccupancyObservation>('occupied')
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState<DiscrepancyResolution>('pms_confirmed')
  const [resolutionNote, setResolutionNote] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setObserved('occupied')
    setNote('')
    setResolution('pms_confirmed')
    setResolutionNote('')
  }, [open, roomId])

  useModalFocusTrap(sheetRef, open, onClose)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
    queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
    queryClient.invalidateQueries({ queryKey: ['room-discrepancies', roomId] })
  }

  async function handleReport() {
    setLoading(true)
    try {
      await housekeepingApi.reportDiscrepancy(roomId, { housekeeping_observed: observed, note: note.trim() || undefined })
      toast.success(t('housekeeping.roomDetail.discrepancy.reportedToast', { roomNumber }))
      invalidate()
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.discrepancy.reportError'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve() {
    if (!openDiscrepancy) return
    setLoading(true)
    try {
      await housekeepingApi.resolveDiscrepancy(openDiscrepancy.id, { resolution, note: resolutionNote.trim() || undefined })
      toast.success(t('housekeeping.roomDetail.discrepancy.resolvedToast', { roomNumber }))
      invalidate()
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.discrepancy.resolveError'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  const observedLabel = openDiscrepancy?.housekeeping_observed === 'occupied'
    ? t('housekeeping.roomDetail.discrepancy.observedOccupied')
    : t('housekeeping.roomDetail.discrepancy.observedVacant')

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="room-discrepancy-title" onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} className="relative flex max-h-[88%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="room-discrepancy-title" className="font-display text-[24px] leading-[1.1] text-ink">
              {t(openDiscrepancy ? 'housekeeping.roomDetail.discrepancy.resolveTitle' : 'housekeeping.roomDetail.discrepancy.reportTitle')}
            </p>
            <p className="mt-0.5 text-[12px] text-ink3">{t('housekeeping.roomDetail.roomLabel', { roomNumber })}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 rounded-lg p-1.5" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4 text-ink3" /></Button>
        </div>

        {openDiscrepancy ? (
          <>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink2">
              <p><span className="font-semibold text-ink">{t('housekeeping.roomDetail.discrepancy.housekeepingObserved')}:</span> {observedLabel}</p>
              <p className="mt-1"><span className="font-semibold text-ink">{t('housekeeping.roomDetail.discrepancy.pmsFrontDesk')}:</span> {pmsStatusLabel(openDiscrepancy.pms_status_at_report, t)}</p>
              {openDiscrepancy.note && <p className="mt-1 text-ink3">{openDiscrepancy.note}</p>}
            </div>

            {canResolve ? (
              <>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.discrepancy.resolutionLabel')}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.discrepancy.resolutionLabel')}</p>
                  <div className="flex flex-col gap-1.5">
                    {RESOLUTIONS.map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={resolution === r} onClick={() => setResolution(r)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${resolution === r ? 'border-ink bg-surface-2 font-medium text-ink' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}>
                        <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${resolution === r ? 'border-ink bg-ink' : 'border-ink-4'}`} aria-hidden="true" />
                        {t(`housekeeping.roomDetail.discrepancy.resolution.${r}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="room-discrepancy-resolution-note" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.discrepancy.noteLabel')}</label>
                  <textarea id="room-discrepancy-resolution-note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={2}
                    className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
                  <Button variant="primary" loading={loading} onClick={handleResolve}>{t('housekeeping.roomDetail.discrepancy.confirmResolve')}</Button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-ink3">{t('housekeeping.roomDetail.discrepancy.awaitingResolution')}</p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('housekeeping.roomDetail.discrepancy.observedLabel')}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.discrepancy.observedLabel')}</p>
              <div className="flex flex-col gap-1.5">
                {(['occupied', 'vacant'] as const).map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={observed === o} onClick={() => setObserved(o)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${observed === o ? 'border-ink bg-surface-2 font-medium text-ink' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}>
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${observed === o ? 'border-ink bg-ink' : 'border-ink-4'}`} aria-hidden="true" />
                    {t(o === 'occupied' ? 'housekeeping.roomDetail.discrepancy.observedOccupied' : 'housekeeping.roomDetail.discrepancy.observedVacant')}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink2">
              <p className="font-semibold text-ink">{t('housekeeping.roomDetail.discrepancy.pmsFrontDesk')}</p>
              <p className="mt-0.5">{t('housekeeping.roomDetail.discrepancy.pmsCurrentlyMarked', { status: pmsStatusLabel(pmsStatus, t) })}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="room-discrepancy-note" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.discrepancy.noteLabel')}</label>
              <textarea id="room-discrepancy-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder={t('housekeeping.roomDetail.discrepancy.notePlaceholder')}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            </div>

            <p className="text-[11.5px] text-ink3">{t('housekeeping.roomDetail.discrepancy.alertNote')}</p>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button variant="primary" loading={loading} onClick={handleReport}>{t('housekeeping.roomDetail.discrepancy.confirmReport')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
