'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { housekeepingApi, type InspectionTemplateItem } from '@/lib/api/housekeeping'
import {
  deriveInspectionResult,
  requiredFailedPhotoItems,
  requiredUnansweredItems,
  selectInspectionTemplate,
  type InspectionAnswer,
  type InspectionAnswers,
} from '@/lib/housekeeping/inspectionWorkflow'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface Props {
  roomId: string
  roomNumber: string
  roomTypeId?: string | null
  previousCorrections?: string[]
  open: boolean
  onClose: () => void
}

export function InspectionDrawer({ roomId, roomNumber, roomTypeId, previousCorrections = [], open, onClose }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const firstIncompleteRef = useRef<HTMLDivElement>(null)
  const [answers, setAnswers] = useState<InspectionAnswers>({})
  const [notes, setNotes] = useState('')
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<Record<string, File>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const templatesQuery = useQuery({
    queryKey: ['inspection-templates'],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const templates = (templatesQuery.data as { data?: Parameters<typeof selectInspectionTemplate>[0] } | undefined)?.data ?? []
  const template = selectInspectionTemplate(templates, roomTypeId)
  const items = template?.items ?? []
  const missingRequired = requiredUnansweredItems(items, answers)
  const missingPhotos = requiredFailedPhotoItems(items, answers, new Set(Object.keys(photos)))

  useEffect(() => {
    if (!open) return
    setAnswers({})
    setNotes('')
    setItemNotes({})
    setPhotos({})
    setSubmitError(null)
  }, [open, roomId])

  useModalFocusTrap(drawerRef, open, onClose)

  function setAnswer(item: InspectionTemplateItem, answer: InspectionAnswer) {
    if (!item.id) return
    setAnswers((current) => ({ ...current, [item.id!]: answer }))
    setSubmitError(null)
  }

  function focusIncomplete() {
    firstIncompleteRef.current?.focus({ preventScroll: false })
  }

  async function handleSubmit() {
    if (!template) return
    if (missingRequired.length > 0) {
      setSubmitError(t('housekeeping.roomDetail.inspection.requiredRemaining', { count: missingRequired.length }))
      requestAnimationFrame(focusIncomplete)
      return
    }
    if (missingPhotos.length > 0) {
      setSubmitError(t('housekeeping.roomDetail.inspection.requiredPhotosRemaining', { count: missingPhotos.length }))
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const overallResult = deriveInspectionResult(items, answers)
      await housekeepingApi.completeInspection({
        room_id: roomId,
        template_id: template.id!,
        overall_result: overallResult,
        notes: notes.trim() || undefined,
        items: items
          .filter((item) => item.id && answers[item.id])
          .map((item) => ({ template_item_id: item.id!, result: answers[item.id!]!, note: itemNotes[item.id!]?.trim() || undefined })),
      }, photos)
      toast.success(overallResult === 'passed'
        ? t('housekeeping.roomDetail.inspection.passedToast', { roomNumber })
        : t('housekeeping.roomDetail.inspection.failedToast', { roomNumber }))
      for (const key of ['housekeeping-board', 'my-rooms', 'team-plan', 'housekeeping-assignments']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      onClose()
    } catch (error: any) {
      setSubmitError(error?.response?.data?.detail ?? t('housekeeping.roomDetail.inspection.submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} aria-hidden="true" />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="inspect-room-title" className="relative flex max-h-[92%] flex-col rounded-t-[var(--r-lg)] border-t border-line bg-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-line px-6 pb-4 pt-5">
          <div><h3 id="inspect-room-title" className="font-display text-[24px] leading-[1.1] text-ink">{t('housekeeping.roomDetail.inspection.title', { roomNumber })}</h3><p className="mt-1 text-sm text-ink3">{template?.name ?? t('housekeeping.roomDetail.inspection.loadingTemplate')}</p></div>
          <Button variant="ghost" onClick={onClose} aria-label={t('housekeeping.roomDetail.closeAria')} className="min-h-10 min-w-10 p-0"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {previousCorrections.length > 0 && <section className="mb-5 rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--alert)]">{t('housekeeping.roomDetail.inspection.previousCorrections')}</p><ul className="mt-2 space-y-1 text-sm text-ink">{previousCorrections.map((correction) => <li key={correction}>• {correction}</li>)}</ul></section>}
          {templatesQuery.isLoading ? <p className="text-sm text-ink3">{t('housekeeping.roomDetail.inspection.loadingItems')}</p> : !template ? <section className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] p-4"><p className="font-medium text-[var(--alert)]">{t('housekeeping.roomDetail.inspection.noTemplate')}</p><div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => templatesQuery.refetch()}>{t('common.retry')}</Button><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button></div></section> : <>
            <p className="mb-5 text-sm text-ink2">{t('housekeeping.roomDetail.inspection.progress', { checked: Object.keys(answers).length, total: items.length })}</p>
            {Object.entries(items.reduce<Record<string, InspectionTemplateItem[]>>((groups, item) => { (groups[item.section] ??= []).push(item); return groups }, {})).map(([section, sectionItems]) => <section key={section} className="mb-6" aria-labelledby={`inspection-section-${section}`}><h4 id={`inspection-section-${section}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-ink3">{section}</h4><div className="mt-3 space-y-3">{sectionItems.map((item) => {
              const answer = item.id ? answers[item.id] : undefined
              const incomplete = item.is_required && !answer
              return <div key={item.id ?? item.description} ref={incomplete ? firstIncompleteRef : undefined} tabIndex={incomplete ? -1 : undefined} className={`rounded-[var(--r-md)] border p-3 ${incomplete ? 'border-[var(--caution-line)] bg-[var(--caution-soft)]/30' : 'border-line bg-surface-2'}`}><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium text-ink">{item.description}{item.is_required && <span className="ml-1 text-[var(--alert)]">*</span>}</p><div className="flex gap-1" role="group" aria-label={item.description}>{(['pass', 'fail', 'na'] as const).map((choice) => <button key={choice} type="button" onClick={() => setAnswer(item, choice)} className={`min-h-9 rounded-md border px-2.5 text-xs font-semibold ${answer === choice ? choice === 'fail' ? 'border-[var(--alert)] bg-[var(--alert)] text-white' : 'border-[var(--ready)] bg-[var(--ready)] text-white' : 'border-line text-ink2 hover:border-ink-4'}`}>{choice === 'pass' ? t('housekeeping.roomDetail.inspection.passChoice') : choice === 'fail' ? t('housekeeping.roomDetail.inspection.failChoice') : t('housekeeping.roomDetail.inspection.naChoice')}</button>)}</div></div>
                {answer === 'fail' && item.id && <div className="mt-3 space-y-2"><label className="block text-xs font-medium text-ink2">{t('housekeeping.roomDetail.inspection.itemNote')}<textarea value={itemNotes[item.id] ?? ''} onChange={(event) => setItemNotes((current) => ({ ...current, [item.id!]: event.target.value }))} rows={2} className="mt-1 w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" /></label>{item.requires_photo_on_fail && <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--alert)]"><Camera className="h-4 w-4" />{photos[item.id] ? photos[item.id].name : t('housekeeping.roomDetail.inspection.addRequiredPhoto')}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPhotos((current) => ({ ...current, [item.id!]: file })) }} /></label>}</div>}</div>
            })}</div></section>)}
            <section><label htmlFor="inspection-notes" className="text-xs font-semibold uppercase tracking-[0.1em] text-ink3">{t('housekeeping.roomDetail.inspection.notesLabel')}</label><textarea id="inspection-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder={t('housekeeping.roomDetail.inspection.notesPlaceholder')} className="mt-2 w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" /></section>
          </>}
          {submitError && <p role="alert" className="mt-4 text-sm text-[var(--alert)]">{submitError}</p>}
        </div>
        {template && <div className="flex justify-end gap-2 border-t border-line bg-surface px-6 py-4"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={submitting} onClick={handleSubmit}><Check className="h-4 w-4" />{t('housekeeping.roomDetail.inspection.submit')}</Button></div>}
      </div>
    </div>
  )
}
