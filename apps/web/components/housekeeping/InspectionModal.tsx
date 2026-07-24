'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format } from 'date-fns'
import { X, Check, Minus, ClipboardCheck, Loader2, Timer, Camera, RotateCcw } from 'lucide-react'
import { housekeepingApi, InspectionTemplate } from '@/lib/api/housekeeping'
import { getCleanTypeLabel } from '@/lib/utils/cleanType'
import { Button } from '@/components/ui/Button'

interface Props {
  roomId: string
  roomNumber: string
  cleanedBy?: string
  cleanedAt?: string | null
  cleanType?: string | null
  lastCleanMinutes?: number | null
  lastCleanBaseMinutes?: number | null
  checklistDone?: number
  checklistTotal?: number
  photoCount?: number
  isOpen: boolean
  onClose: () => void
  onSuccess: (result: OverallResult) => void
}

type ItemResult = 'pass' | 'fail' | 'na'
type OverallResult = 'passed' | 'failed' | 'conditional'

function calcOverallResult(
  items: { id: string | null; is_required: boolean }[],
  itemResults: Record<string, ItemResult>,
): OverallResult {
  if (items.length === 0) return 'passed'
  const requiredItems = items.filter((item) => item.is_required)
  if (requiredItems.length === 0) return 'passed'

  const anyRequiredFailed = requiredItems.some((item) => {
    const key = item.id ?? String(items.indexOf(item))
    return itemResults[key] === 'fail'
  })
  if (anyRequiredFailed) return 'failed'

  const allRequiredPassed = requiredItems.every((item) => {
    const key = item.id ?? String(items.indexOf(item))
    return itemResults[key] === 'pass'
  })
  if (allRequiredPassed) return 'passed'

  return 'conditional'
}

function OverallResultBadge({ result, t }: { result: OverallResult; t: TFunction }) {
  const cfg: Record<OverallResult, { cls: string; labelKey: string }> = {
    passed: { cls: 'bg-green-100 text-[var(--ready)] border-[var(--ready-line)]', labelKey: 'housekeeping.inspectionModal.resultBadge.passed' },
    failed: { cls: 'bg-[var(--alert-soft)] text-[var(--alert)] border-[var(--alert-line)]', labelKey: 'housekeeping.inspectionModal.resultBadge.failed' },
    conditional: { cls: 'bg-yellow-100 text-yellow-700 border-yellow-200', labelKey: 'housekeeping.inspectionModal.resultBadge.conditional' },
  }
  const { cls, labelKey } = cfg[result]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded border text-xs font-semibold ${cls}`}>
      {t(labelKey)}
    </span>
  )
}

export function InspectionModal({ roomId, roomNumber, cleanedBy, cleanedAt, cleanType, lastCleanMinutes, lastCleanBaseMinutes, checklistDone = 0, checklistTotal = 0, photoCount = 0, isOpen, onClose, onSuccess }: Props) {
  const { t } = useTranslation()
  const [itemResults, setItemResults] = useState<Record<string, ItemResult>>({})
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({})
  const [itemPhotos, setItemPhotos] = useState<Record<string, File>>({})
  const [notes, setNotes] = useState('')
  const [manualOverall, setManualOverall] = useState<OverallResult>('passed')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const pendingResultRef = useRef<OverallResult>('passed')
  const pendingPhotoUploadsRef = useRef<Record<string, File>>({})
  const [savedInspectionId, setSavedInspectionId] = useState<string | null>(null)
  const [reCleanStep, setReCleanStep] = useState(false)
  const [reCleanNote, setReCleanNote] = useState('')
  const [reCleanError, setReCleanError] = useState<string | null>(null)

  // Fetch templates only when modal is open
  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['inspection-templates'],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: isOpen,
    staleTime: 300_000,
  })

  const templates: InspectionTemplate[] = templatesData?.data?.templates ?? templatesData?.data ?? []
  const template: InspectionTemplate | undefined =
    templates.find((t) => t.is_default) ?? templates[0]

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setItemResults({})
      setItemNotes({})
      setItemPhotos({})
      pendingPhotoUploadsRef.current = {}
      setNotes('')
      setManualOverall('passed')
      setSubmitError(null)
      setSavedInspectionId(null)
      setReCleanStep(false)
      setReCleanNote('')
      setReCleanError(null)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const finishInspection = () => {
    if (pendingResultRef.current === 'failed') {
      const failedNotes = Object.values(itemNotes).filter(Boolean).join('; ')
      setReCleanNote(failedNotes)
      setReCleanStep(true)
    } else {
      onSuccess(pendingResultRef.current)
    }
  }

  const uploadPhotoEvidence = async (inspectionId: string) => {
    await Promise.all(
      Object.entries(pendingPhotoUploadsRef.current).map(([templateItemId, file]) =>
        housekeepingApi.uploadInspectionPhoto(inspectionId, templateItemId, file),
      ),
    )
  }

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof housekeepingApi.submitInspection>[0]) =>
      housekeepingApi.submitInspection(payload),
    onSuccess: async (response) => {
      try {
        await uploadPhotoEvidence(response.data.id)
        finishInspection()
      } catch (err: any) {
        setSavedInspectionId(response.data.id)
        setSubmitError(err?.response?.data?.detail ?? err?.message ?? t('housekeeping.inspectionModal.errors.photoUploadFailed'))
      }
    },
    onError: (err: any) => {
      setSubmitError(err?.response?.data?.detail ?? err?.message ?? t('housekeeping.inspectionModal.errors.submitFailed'))
    },
  })

  const reCleanMutation = useMutation({
    mutationFn: () => housekeepingApi.sendReClean(roomId, reCleanNote.trim() || undefined),
    onSuccess: () => {
      onSuccess('failed')
    },
    onError: (err: any) => {
      setReCleanError(err?.response?.data?.detail ?? err?.message ?? t('housekeeping.inspectionModal.errors.reCleanFailed'))
    },
  })

  if (!isOpen) return null

  if (reCleanStep) {
    return (
      <>
        <div className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50" aria-hidden="true" />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('housekeeping.inspectionModal.reCleanSubtitle', { roomNumber })}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
              <div className="flex items-center gap-2.5">
                <RotateCcw className="w-5 h-5 text-[var(--alert)] shrink-0" />
                <div>
                  <h2 className="text-base font-bold text-gray-900">{t('housekeeping.inspectionModal.reCleanTitle')}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{t('housekeeping.inspectionModal.reCleanSubtitle', { roomNumber })}</p>
                </div>
              </div>
              <Button variant="ghost" onClick={onClose} className="p-1.5 rounded-lg" aria-label={t('housekeeping.inspectionModal.closeAria')}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="flex items-start gap-2 px-3 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg text-sm text-[var(--alert)]">
                <X className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('housekeeping.inspectionModal.reCleanFailedBanner')}</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('housekeeping.inspectionModal.reCleanNoteLabel')} <span className="text-gray-400 font-normal">{t('housekeeping.inspectionModal.optionalTag')}</span>
                </label>
                <textarea
                  value={reCleanNote}
                  onChange={(e) => setReCleanNote(e.target.value)}
                  rows={3}
                  placeholder={t('housekeeping.inspectionModal.reCleanNotePlaceholder')}
                  className="w-full border border-white/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-surface/50 backdrop-blur-sm"
                />
              </div>
              {reCleanError && (
                <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                  {reCleanError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/60 shrink-0">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('housekeeping.inspectionModal.skipClose')}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => reCleanMutation.mutate()}
                disabled={reCleanMutation.isPending}
              >
                {reCleanMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('housekeeping.inspectionModal.dispatching')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    {t('housekeeping.inspectionModal.dispatchReClean')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const items = template?.items ?? []

  // Group items by section
  const sections: Record<string, typeof items> = {}
  for (const item of items) {
    if (!sections[item.section]) sections[item.section] = []
    sections[item.section].push(item)
  }

  const calculatedResult =
    items.length > 0
      ? calcOverallResult(
          items.map((item, idx) => ({ id: item.id, is_required: item.is_required, _idx: idx })),
          itemResults,
        )
      : manualOverall

  function setItemResult(key: string, result: ItemResult) {
    setItemResults((prev) => ({ ...prev, [key]: result }))
  }

  function handleSubmit() {
    setSubmitError(null)
    if (!template?.id) {
      setSubmitError(t('housekeeping.inspectionModal.errors.noTemplate'))
      return
    }

    // Validate required items are answered (pass or fail)
    const unansweredRequired = items.filter((item, idx) => {
      const key = item.id ?? String(idx)
      const result = itemResults[key]
      return item.is_required && (result === undefined || result === 'na')
    })
    if (unansweredRequired.length > 0) {
      setSubmitError(
        t(unansweredRequired.length > 1 ? 'housekeeping.inspectionModal.errors.unansweredRequiredOther' : 'housekeeping.inspectionModal.errors.unansweredRequiredOne', { count: unansweredRequired.length })
      )
      return
    }

    const missingRequiredPhotos = items.filter((item, idx) => {
      const key = item.id ?? String(idx)
      return item.requires_photo_on_fail && itemResults[key] === 'fail' && !itemPhotos[key]
    })
    if (missingRequiredPhotos.length > 0) {
      setSubmitError(
        t(missingRequiredPhotos.length > 1 ? 'housekeeping.inspectionModal.errors.missingPhotoOther' : 'housekeeping.inspectionModal.errors.missingPhotoOne', { count: missingRequiredPhotos.length }),
      )
      return
    }

    const payload = {
      room_id: roomId,
      template_id: template.id,
      overall_result: calculatedResult,
      notes: notes.trim() || undefined,
      items: items.map((item, idx) => ({
        template_item_id: item.id,
        result: itemResults[item.id ?? String(idx)] ?? 'na',
        note: itemNotes[item.id ?? String(idx)]?.trim() || undefined,
      })),
    }
    pendingResultRef.current = calculatedResult
    pendingPhotoUploadsRef.current = Object.fromEntries(
      items.flatMap((item, idx) => {
        const key = item.id ?? String(idx)
        const file = itemPhotos[key]
        return itemResults[key] === 'fail' && item.id && file ? [[item.id, file]] : []
      }),
    )
    mutation.mutate(payload)
  }

  async function retryPhotoEvidence() {
    if (!savedInspectionId) return
    setSubmitError(null)
    try {
      await uploadPhotoEvidence(savedInspectionId)
      setSavedInspectionId(null)
      finishInspection()
    } catch (err: any) {
      setSubmitError(err?.response?.data?.detail ?? err?.message ?? t('housekeeping.inspectionModal.errors.retryPhotoFailed'))
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('housekeeping.inspectionModal.title', { roomNumber })}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <ClipboardCheck className="w-5 h-5 text-[var(--ready)] shrink-0" />
              <div>
                <h2 className="text-base font-bold text-gray-900">{t('housekeeping.inspectionModal.title', { roomNumber })}</h2>
                {(cleanedBy || cleanType) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[
                      cleanedBy && t('housekeeping.inspectionModal.cleanedBy', { name: cleanedBy }),
                      cleanType && getCleanTypeLabel(cleanType),
                      cleanedAt && format(new Date(cleanedAt), 'h:mm a'),
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
                {lastCleanMinutes != null && (
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Timer className="w-3 h-3" />
                      {lastCleanMinutes}m{lastCleanBaseMinutes != null ? t('housekeeping.inspectionModal.lastCleanBase', { minutes: lastCleanBaseMinutes }) : ''}
                    </span>
                    {checklistTotal > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Check className="w-3 h-3" />
                        {t('housekeeping.roomDetail.lastClean.itemsCount', { done: checklistDone, total: checklistTotal })}
                      </span>
                    )}
                    {photoCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Camera className="w-3 h-3" />
                        {t(photoCount > 1 ? 'housekeeping.roomDetail.lastClean.photoOther' : 'housekeeping.roomDetail.lastClean.photoOne', { count: photoCount })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={onClose}
              className="p-1.5 rounded-lg"
              aria-label={t('housekeeping.inspectionModal.closeAria')}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm">{t('housekeeping.inspectionModal.loadingTemplate')}</span>
              </div>
            ) : (
              <>
                {/* Template name */}
                {template?.name && (
                  <p className="text-sm font-medium text-gray-700">{template.name}</p>
                )}

                {/* Checklist sections */}
                {!templatesLoading && !template?.id && (
                  <div className="flex items-start gap-2 px-3 py-3 bg-[var(--caution-soft)] border border-[var(--caution-line)] rounded-lg text-sm text-[var(--caution)]">
                    <span className="shrink-0 mt-0.5">⚠</span>
                    <span>{t('housekeeping.inspectionModal.noTemplateWarning')}</span>
                  </div>
                )}

                {items.length > 0 ? (
                  Object.entries(sections).map(([section, sectionItems]) => (
                    <div key={section}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                        {section}
                      </h3>
                      <div className="space-y-2">
                        {sectionItems.map((item) => {
                          const globalIdx = items.indexOf(item)
                          const key = item.id ?? String(globalIdx)
                          const current = itemResults[key]

                          return (
                            <div key={key} className="py-1.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-3">
                                {/* Description + required indicator */}
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                  <span
                                    className={`mt-0.5 shrink-0 w-3 h-3 rounded-full border-2 ${
                                      item.is_required
                                        ? 'border-gray-500 bg-gray-500'
                                        : 'border-gray-300'
                                    }`}
                                  />
                                  <span className="text-sm text-gray-700 leading-tight">
                                    {item.description}
                                  </span>
                                </div>

                                {/* Pass / Fail / N/A toggle */}
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setItemResult(key, 'pass')}
                                    className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                      current === 'pass'
                                        ? 'bg-green-100 text-[var(--ready)] border-green-300'
                                        : 'bg-surface/70 text-gray-400 border-white/90 hover:border-[var(--ready-line)]'
                                    }`}
                                  >
                                    <Check className="w-3 h-3" />
                                    {t('housekeeping.inspectionModal.pass')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setItemResult(key, 'fail')}
                                    className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                      current === 'fail'
                                        ? 'bg-[var(--alert-soft)] text-[var(--alert)] border-red-300'
                                        : 'bg-surface/70 text-gray-400 border-white/90 hover:border-[var(--alert-line)]'
                                    }`}
                                  >
                                    <X className="w-3 h-3" />
                                    {t('housekeeping.inspectionModal.fail')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setItemResult(key, 'na')}
                                    className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                      current === 'na'
                                        ? 'bg-gray-100 text-gray-600 border-gray-300'
                                        : 'bg-surface/70 text-gray-400 border-white/90 hover:border-gray-300'
                                    }`}
                                  >
                                    <Minus className="w-3 h-3" />
                                    {t('housekeeping.inspectionModal.na')}
                                  </button>
                                </div>
                              </div>
                              {/* Per-item note — auto-shown on fail */}
                              {current === 'fail' && (
                                <div className="space-y-2">
                                <input
                                  type="text"
                                  value={itemNotes[key] ?? ''}
                                  onChange={(e) =>
                                    setItemNotes((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  placeholder={t('housekeeping.inspectionModal.itemNotePlaceholder')}
                                  className="w-full text-xs border border-[var(--alert-line)] rounded-md px-2.5 py-1.5 bg-[var(--alert-soft)]/40 text-ink2 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[var(--alert)]/50"
                                />
                                <label className="mt-2 flex items-center gap-2 text-xs text-ink2">
                                  <Camera className="w-3.5 h-3.5 text-[var(--alert)]" />
                                  <span>{item.requires_photo_on_fail ? t('housekeeping.inspectionModal.photoRequired') : t('housekeeping.inspectionModal.photoOptional')}</span>
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(event) => {
                                      const file = event.target.files?.[0]
                                      if (file) setItemPhotos((previous) => ({ ...previous, [key]: file }))
                                    }}
                                    className="max-w-[160px] text-xs"
                                  />
                                  {itemPhotos[key] && <span className="truncate max-w-24 text-[var(--ready)]">{itemPhotos[key].name}</span>}
                                </label>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                ) : null}

                {/* Overall result */}
                <div className="border-t border-white/60 pt-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">{t('housekeeping.inspectionModal.overallResultLabel')}</span>
                    {items.length > 0 ? (
                      <>
                        <OverallResultBadge result={calculatedResult} t={t} />
                        <span className="text-xs text-gray-400">{t('housekeeping.inspectionModal.autoCalculated')}</span>
                      </>
                    ) : (
                      /* No items — manual radio selection */
                      <div className="flex items-center gap-4">
                        {(['passed', 'failed', 'conditional'] as OverallResult[]).map((r) => (
                          <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="overall_result"
                              value={r}
                              checked={manualOverall === r}
                              onChange={() => setManualOverall(r)}
                              className="accent-[var(--accent)]"
                            />
                            <span className="text-sm text-gray-700 capitalize">{t(`housekeeping.inspectionModal.manualResult.${r}`)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('housekeeping.inspectionModal.notesLabel')} <span className="text-gray-400 font-normal">{t('housekeeping.inspectionModal.optionalTag')}</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder={t('housekeeping.inspectionModal.notesPlaceholder')}
                    className="w-full border border-white/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-surface/50 backdrop-blur-sm"
                  />
                </div>

                {/* Error */}
                {submitError && (
                  <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                    {submitError}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/60 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={savedInspectionId ? retryPhotoEvidence : handleSubmit}
              disabled={mutation.isPending || templatesLoading || !template?.id}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('housekeeping.inspectionModal.submitting')}
                </>
              ) : savedInspectionId ? (
                t('housekeeping.inspectionModal.retryPhotoUpload')
              ) : (
                t('housekeeping.inspectionModal.submitInspection')
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
