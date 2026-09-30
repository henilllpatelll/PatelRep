'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { housekeepingApi, type InspectionTemplate } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface Props {
  roomId: string
  roomNumber: string
  open: boolean
  onClose: () => void
}

/**
 * Fail Inspection — the counterpart to RoomDetailDrawer's one-click Pass.
 * Lets a supervisor mark which checklist items need fixing (spec section 13's
 * "2 corrections / label / label"), submits a real inspection record, then
 * triggers the re-clean workflow so My Rooms can surface it to the housekeeper.
 */
export function InspectionFailSheet({ roomId, roomNumber, open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [failedItemIds, setFailedItemIds] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['inspection-templates'],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const template: InspectionTemplate | undefined = (templatesData as { data?: InspectionTemplate[] } | undefined)?.data?.[0]
  const items = template?.items ?? []

  useEffect(() => {
    if (!open) return
    setFailedItemIds(new Set())
    setNotes('')
  }, [open, roomId])

  useModalFocusTrap(sheetRef, open, onClose)

  function toggleItem(itemId: string) {
    setFailedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const canSubmit = failedItemIds.size > 0 || notes.trim().length > 0

  async function handleConfirm() {
    if (!canSubmit) return
    setLoading(true)
    try {
      const inspection = await housekeepingApi.submitInspection({
        room_id: roomId,
        template_id: template?.id ?? null,
        overall_result: 'failed',
        notes: notes.trim() || undefined,
        items: items
          .filter((item) => item.id && failedItemIds.has(item.id))
          .map((item) => ({ template_item_id: item.id, result: 'fail' as const })),
      })
      await housekeepingApi.triggerReclean(inspection.data.id)
      toast.success(t('housekeeping.roomDetail.inspection.failedToast', { roomNumber }))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['team-plan'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      onClose()
    } catch {
      toast.error(t('housekeeping.roomDetail.inspection.failError'))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="room-inspection-fail-title" onKeyDownCapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} className="relative flex max-h-[88%] flex-col gap-4 overflow-y-auto rounded-t-[var(--r-lg)] border-t border-line bg-surface px-6 pb-6 pt-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="room-inspection-fail-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.inspection.failTitle')}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{t('housekeeping.roomDetail.inspection.failSubtitle', { roomNumber })}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 rounded-lg p-1.5" aria-label={t('housekeeping.roomDetail.closeAria')}><X className="h-4 w-4 text-ink3" /></Button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.inspection.itemsLabel')}</p>
          {templatesLoading ? (
            <p className="text-sm text-ink3">{t('housekeeping.roomDetail.inspection.loadingItems')}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-ink3">{t('housekeeping.roomDetail.inspection.noItemsWarning')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map((item) => {
                const checked = Boolean(item.id && failedItemIds.has(item.id))
                return (
                  <button
                    key={item.id ?? item.description}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={!item.id}
                    onClick={() => item.id && toggleItem(item.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors disabled:opacity-50 ${checked ? 'border-[var(--alert-line)] bg-[var(--alert-soft)] font-medium text-[var(--alert)]' : 'border-line bg-surface text-ink2 hover:border-ink-4'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-[var(--alert)] bg-[var(--alert)] text-white' : 'border-ink-4'}`} aria-hidden="true">
                      {checked && <X className="h-3 w-3" />}
                    </span>
                    {item.description}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="room-inspection-fail-notes" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('housekeeping.roomDetail.inspection.notesLabel')}</label>
          <textarea id="room-inspection-fail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder={t('housekeeping.roomDetail.inspection.notesPlaceholder')}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" />
        </div>

        {!canSubmit && (
          <p className="text-xs text-ink3">{t('housekeeping.roomDetail.inspection.noItemsSelected')}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={loading} disabled={!canSubmit} onClick={handleConfirm} className="bg-[var(--alert)] hover:opacity-90">{t('housekeeping.roomDetail.inspection.confirmFail')}</Button>
        </div>
      </div>
    </div>
  )
}
