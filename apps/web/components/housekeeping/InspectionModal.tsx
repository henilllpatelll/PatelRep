'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Check, Minus, ClipboardCheck, Loader2 } from 'lucide-react'
import { housekeepingApi, InspectionTemplate } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'

interface Props {
  roomId: string
  roomNumber: string
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
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

function OverallResultBadge({ result }: { result: OverallResult }) {
  const cfg: Record<OverallResult, { cls: string; label: string }> = {
    passed: { cls: 'bg-green-100 text-green-700 border-green-200', label: 'PASSED' },
    failed: { cls: 'bg-red-100 text-red-700 border-red-200', label: 'FAILED' },
    conditional: { cls: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'CONDITIONAL' },
  }
  const { cls, label } = cfg[result]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded border text-xs font-semibold ${cls}`}>
      {label}
    </span>
  )
}

export function InspectionModal({ roomId, roomNumber, isOpen, onClose, onSuccess }: Props) {
  const [itemResults, setItemResults] = useState<Record<string, ItemResult>>({})
  const [notes, setNotes] = useState('')
  const [manualOverall, setManualOverall] = useState<OverallResult>('passed')
  const [submitError, setSubmitError] = useState<string | null>(null)

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
      setNotes('')
      setManualOverall('passed')
      setSubmitError(null)
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

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof housekeepingApi.submitInspection>[0]) =>
      housekeepingApi.submitInspection(payload),
    onSuccess: () => {
      onSuccess()
    },
    onError: (err: any) => {
      setSubmitError(err?.response?.data?.detail ?? err?.message ?? 'Failed to submit inspection.')
    },
  })

  if (!isOpen) return null

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
      setSubmitError('No inspection template is set up for this hotel. Please create one in Settings before inspecting rooms.')
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
        `${unansweredRequired.length} required item${unansweredRequired.length > 1 ? 's' : ''} (●) must be marked Pass or Fail before submitting.`
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
      })),
    }
    mutation.mutate(payload as any)
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
        aria-label={`Inspect Room ${roomNumber}`}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <ClipboardCheck className="w-5 h-5 text-green-600 shrink-0" />
              <h2 className="text-base font-bold text-gray-900">Inspect Room {roomNumber}</h2>
            </div>
            <Button
              variant="ghost"
              onClick={onClose}
              className="p-1.5 rounded-lg"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm">Loading inspection template…</span>
              </div>
            ) : (
              <>
                {/* Template name */}
                {template?.name && (
                  <p className="text-sm font-medium text-gray-700">{template.name}</p>
                )}

                {/* Checklist sections */}
                {!templatesLoading && !template?.id && (
                  <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    <span className="shrink-0 mt-0.5">⚠</span>
                    <span>No inspection template configured for this hotel. Please create one in Settings before running inspections.</span>
                  </div>
                )}

                {items.length > 0 ? (
                  Object.entries(sections).map(([section, sectionItems]) => (
                    <div key={section}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                        {section}
                      </h3>
                      <div className="space-y-2">
                        {sectionItems.map((item, localIdx) => {
                          const globalIdx = items.indexOf(item)
                          const key = item.id ?? String(globalIdx)
                          const current = itemResults[key]

                          return (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-3 py-1.5"
                            >
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
                                {/* Pass */}
                                <button
                                  type="button"
                                  onClick={() => setItemResult(key, 'pass')}
                                  className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                    current === 'pass'
                                      ? 'bg-green-100 text-green-700 border-green-300'
                                      : 'bg-white/70 text-gray-400 border-white/90 hover:border-green-200'
                                  }`}
                                >
                                  <Check className="w-3 h-3" />
                                  Pass
                                </button>

                                {/* Fail */}
                                <button
                                  type="button"
                                  onClick={() => setItemResult(key, 'fail')}
                                  className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                    current === 'fail'
                                      ? 'bg-red-100 text-red-700 border-red-300'
                                      : 'bg-white/70 text-gray-400 border-white/90 hover:border-red-200'
                                  }`}
                                >
                                  <X className="w-3 h-3" />
                                  Fail
                                </button>

                                {/* N/A */}
                                <button
                                  type="button"
                                  onClick={() => setItemResult(key, 'na')}
                                  className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors ${
                                    current === 'na'
                                      ? 'bg-gray-100 text-gray-600 border-gray-300'
                                      : 'bg-white/70 text-gray-400 border-white/90 hover:border-gray-300'
                                  }`}
                                >
                                  <Minus className="w-3 h-3" />
                                  N/A
                                </button>
                              </div>
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
                    <span className="text-sm font-medium text-gray-700">Overall Result:</span>
                    {items.length > 0 ? (
                      <>
                        <OverallResultBadge result={calculatedResult} />
                        <span className="text-xs text-gray-400">(auto-calculated)</span>
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
                              className="accent-brand-600"
                            />
                            <span className="text-sm text-gray-700 capitalize">{r}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Notes <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Any notes about this inspection…"
                    className="w-full border border-white/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none bg-white/50 backdrop-blur-sm"
                  />
                </div>

                {/* Error */}
                {submitError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              disabled={mutation.isPending || templatesLoading || !template?.id}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit Inspection →'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
