'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Loader2, Archive, AlertCircle } from 'lucide-react'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { ApiClientError } from '@/lib/api/client'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'

interface Props {
  isOpen: boolean
  onClose: () => void
  onArchived: () => void
}

const ARCHIVABLE_STATUSES = new Set(['completed', 'cancelled'])

export function BulkArchiveModal({ isOpen, onClose, onArchived }: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ageInput, setAgeInput] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)

  const { data, isLoading: candidatesLoading, isError: candidatesError, refetch: refetchCandidates } = useQuery({
    queryKey: ['work-orders', 'bulk-archive-candidates'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    enabled: isOpen,
  })

  const candidates: WorkOrder[] = (data?.data ?? []).filter((wo) => ARCHIVABLE_STATUSES.has(wo.status))

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set())
      setAgeInput('30')
      setError(null)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const archiveSelectedMutation = useMutation({
    mutationFn: () => engineeringApi.bulkArchiveWorkOrders({ work_order_ids: [...selected] }),
    onSuccess: () => {
      onArchived()
      onClose()
    },
    onError: (err) => {
      setError(
        t('engineering.workOrdersPage.archiveModalError', {
          error: err instanceof ApiClientError ? err.message : String(err),
        }),
      )
    },
  })

  const archiveByAgeMutation = useMutation({
    mutationFn: () => engineeringApi.bulkArchiveWorkOrdersByAge({ older_than_days: Number(ageInput) }),
    onSuccess: () => {
      onArchived()
      onClose()
    },
    onError: (err) => {
      setError(
        t('engineering.workOrdersPage.archiveModalError', {
          error: err instanceof ApiClientError ? err.message : String(err),
        }),
      )
    },
  })

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('engineering.workOrdersPage.archiveModalTitle')}
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <Archive className="w-5 h-5 text-[var(--caution)] shrink-0" />
              <h2 className="text-base font-bold text-ink">{t('engineering.workOrdersPage.archiveModalTitle')}</h2>
            </div>
            <IconButton onClick={onClose} aria-label={t('engineering.createWorkOrder.closeModal')}>
              <X className="w-5 h-5" />
            </IconButton>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <div>
              <p className="text-sm text-ink2 mb-2">{t('engineering.workOrdersPage.archiveModalSelectPrompt')}</p>
              {v2 && candidatesLoading ? (
                <div className="space-y-1.5">
                  <Skeleton variant="text" className="h-10 w-full" />
                  <Skeleton variant="text" className="h-10 w-full" />
                  <Skeleton variant="text" className="h-10 w-full" />
                </div>
              ) : v2 && candidatesError ? (
                <StateBlock status="error" error={{ onRetry: () => refetchCandidates() }} className="py-3" />
              ) : candidates.length === 0 ? (
                <p className="text-sm text-ink3">{t('engineering.workOrdersPage.archiveModalNoneAvailable')}</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto border border-line rounded-[var(--r-md)] p-2">
                  {candidates.map((wo) => (
                    <label
                      key={wo.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(wo.id)}
                        onChange={() => toggleSelected(wo.id)}
                      />
                      <span className="text-sm text-ink truncate">
                        WO-{wo.work_order_number} · {wo.title} · {wo.status}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selected.size > 0 && (
                <p className="text-xs text-ink3 mt-1.5">
                  {t('engineering.workOrdersPage.archiveModalSelectedCount', { count: selected.size })}
                </p>
              )}
              <Button
                variant="primary"
                onClick={() => archiveSelectedMutation.mutate()}
                disabled={selected.size === 0 || archiveSelectedMutation.isPending}
                className="mt-3"
              >
                {archiveSelectedMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('engineering.workOrdersPage.archiveModalArchiveSelected')}
              </Button>
            </div>

            <div className="border-t border-line pt-4">
              <label className="block text-sm text-ink2 mb-2">
                {t('engineering.workOrdersPage.archiveModalByAgeLabel')}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={ageInput}
                  onChange={(e) => setAgeInput(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-ink3">{t('engineering.workOrdersPage.archiveModalByAgeDays')}</span>
                <Button
                  variant="outline"
                  onClick={() => archiveByAgeMutation.mutate()}
                  disabled={archiveByAgeMutation.isPending || !ageInput}
                >
                  {archiveByAgeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('engineering.workOrdersPage.archiveModalByAgeButton')}
                </Button>
              </div>
            </div>

            {error && (
              <p className="flex items-start gap-2 text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
