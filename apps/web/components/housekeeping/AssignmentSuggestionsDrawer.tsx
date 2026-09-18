'use client'

import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Sparkles, Building2 } from 'lucide-react'
import { housekeepingApi, type AssignmentSuggestion } from '@/lib/api/housekeeping'
import { ApiClientError } from '@/lib/api/client'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface Props {
  isOpen: boolean
  onClose: () => void
  suggestions: AssignmentSuggestion[]
  date: string
  shiftId?: string | null
  onApplied?: () => void
}

export function AssignmentSuggestionsDrawer({ isOpen, onClose, suggestions, date, shiftId, onApplied }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(drawerRef, isOpen, onClose)

  const totalRooms = suggestions.reduce((sum, s) => sum + s.room_count, 0)

  const applyMutation = useMutation({
    mutationFn: () =>
      housekeepingApi.saveAssignments({
        date,
        shift_id: shiftId ?? null,
        is_ai_suggested: true,
        assignments: suggestions.flatMap((s) =>
          s.rooms.map((r) => ({
            room_id: r.room_id,
            housekeeper_id: s.housekeeper.id,
            sequence_order: r.sequence,
          })),
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      toast.success(t('housekeeping.assignmentSuggestions.applied', { count: totalRooms }))
      onApplied?.()
      onClose()
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : t('housekeeping.assignmentSuggestions.applyFailure'))
    },
  })

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/30 backdrop-blur-sm z-drawer transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('housekeeping.assignmentSuggestions.title')}
        className="fixed right-0 top-0 h-full w-[440px] max-w-full bg-surface shadow-2xl border-l border-line z-drawer flex flex-col outline-none"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-4 border-b border-line">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--ai-soft)] text-[var(--ai)]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink">{t('housekeeping.assignmentSuggestions.title')}</h2>
              <p className="mt-0.5 text-xs text-ink3">
                {t('housekeeping.assignmentSuggestions.subtitle', {
                  roomCount: totalRooms,
                  hkCount: suggestions.length,
                })}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={onClose}
            className="shrink-0 p-1.5"
            aria-label={t('housekeeping.assignmentSuggestions.closeAria')}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {suggestions.map((s) => (
            <div key={s.housekeeper.id} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {s.housekeeper.preferred_name || s.housekeeper.full_name || t('housekeeping.assignmentSuggestions.unnamedHousekeeper')}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink3">
                    {s.housekeeper.building_affinity && (
                      <>
                        <Building2 className="h-3 w-3" aria-hidden="true" />
                        {t('housekeeping.assignmentSuggestions.building', { building: s.housekeeper.building_affinity })}
                        {' · '}
                      </>
                    )}
                    {t('housekeeping.assignmentSuggestions.roomsAndMinutes', {
                      count: s.room_count,
                      minutes: s.total_minutes,
                    })}
                  </p>
                </div>
              </div>

              <ol className="mt-3 flex flex-wrap gap-1.5">
                {s.rooms.map((r) => (
                  <li
                    key={r.room_id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink2"
                    title={t('housekeeping.assignmentSuggestions.roomTooltip', {
                      floor: r.floor ?? '—',
                      minutes: r.base_clean_minutes,
                    })}
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ai-soft)] text-[9px] font-bold text-[var(--ai)]">
                      {r.sequence}
                    </span>
                    {r.room_number}
                    {r.is_vip && <span className="text-[9px] font-bold text-amber-600">VIP</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-line">
          <Button variant="ghost" onClick={onClose} disabled={applyMutation.isPending}>
            {t('housekeeping.assignmentSuggestions.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending || totalRooms === 0}
          >
            {applyMutation.isPending ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {t('housekeeping.assignmentSuggestions.applying')}
              </>
            ) : (
              t('housekeeping.assignmentSuggestions.applyAll', { count: totalRooms })
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
