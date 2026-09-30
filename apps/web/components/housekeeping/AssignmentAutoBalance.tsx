'use client'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Sparkles } from 'lucide-react'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { ApiClientError } from '@/lib/api/client'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { buildAutoBalancePreview, type AutoBalancePreview } from '@/lib/housekeeping/assignmentView'
import type { AssignmentPoolRoom } from '@/lib/housekeeping/assignmentView'

interface Props {
  isOpen: boolean
  onClose: () => void
  date: string
  shiftId: string | null
  currentRooms: AssignmentPoolRoom[]
  nameById: Record<string, string>
}

/**
 * Generates a proposed plan from the existing CP-SAT suggester and stages it
 * — it never publishes on its own; Publish Changes in the workspace header
 * still owns that step (see spec: auto-balance produces a plan, not a save).
 */
export function AssignmentAutoBalance({ isOpen, onClose, date, shiftId, currentRooms, nameById }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(panelRef, isOpen, onClose)
  const { setPendingAssignment, pendingAssignments } = useHousekeepingStore()
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<AutoBalancePreview | null>(null)
  const [noWorkMessage, setNoWorkMessage] = useState<string | null>(null)
  const [excludedStaff, setExcludedStaff] = useState<Array<{ id: string; reason: 'on_break' | 'off_shift' | 'unavailable' }>>([])

  if (!isOpen) return null

  const runAutoBalance = async () => {
    setLoading(true)
    setNoWorkMessage(null)
    setPreview(null)
    try {
      const result = await housekeepingApi.aiSuggestAssignments(date, shiftId ?? undefined)
      setExcludedStaff(result.data.excluded_staff ?? [])
      const suggestions = result.data.suggestions ?? []
      if (suggestions.reduce((sum, s) => sum + s.room_count, 0) === 0) {
        setNoWorkMessage(result.data.message || t('housekeeping.assignmentSidebar.noRoomsNeedWork'))
        return
      }
      setPreview(buildAutoBalancePreview(currentRooms, suggestions, nameById, t('housekeeping.assignWorkspace.row.unassigned')))
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('housekeeping.assignmentSidebar.failure'))
    } finally {
      setLoading(false)
    }
  }

  const stagePlan = () => {
    if (!preview) return
    const unlockedChanges = preview.changes.filter((change) => !pendingAssignments[change.roomId])
    for (const change of unlockedChanges) {
      setPendingAssignment(change.roomId, change.toId)
    }
    toast.success(t('housekeeping.assignWorkspace.autoBalance.staged', { count: unlockedChanges.length }))
    setPreview(null)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-modal bg-ink/35 px-4" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-modal flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={t('housekeeping.assignWorkspace.autoBalance.title')}>
        <div ref={panelRef} tabIndex={-1} className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--ai-soft)] text-[var(--ai)]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">{t('housekeeping.assignWorkspace.autoBalance.title')}</h2>
                <p className="mt-0.5 text-xs text-ink3">{t('housekeeping.assignWorkspace.autoBalance.subtitle')}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={onClose} className="shrink-0 p-1.5" aria-label={t('housekeeping.assignmentSuggestions.closeAria')}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!preview && !noWorkMessage && (
            <div className="mt-5 flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-ink3">{t('housekeeping.assignWorkspace.autoBalance.intro')}</p>
              <Button variant="ai" onClick={runAutoBalance} disabled={loading}>
                {loading ? t('housekeeping.assignmentSidebar.assigning') : t('housekeeping.assignWorkspace.autoBalance.generate')}
              </Button>
            </div>
          )}

          {noWorkMessage && <p className="mt-5 py-6 text-center text-sm text-ink3">{noWorkMessage}</p>}

          {preview && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-ink2">
                {t('housekeeping.assignWorkspace.autoBalance.summary', { rooms: preview.totalRooms, credits: preview.totalCredits, attendants: preview.attendantCount })}
              </p>

              <div className="space-y-1.5">
                {preview.perHousekeeper.map((hk) => (
                  <div key={hk.id} className="flex items-center justify-between rounded-[var(--r-sm)] border border-line bg-surface-2 px-3 py-1.5 text-sm">
                    <span className="text-ink">{hk.name}</span>
                    <span className="font-mono text-ink2">{t('housekeeping.assignWorkspace.autoBalance.creditsChange', { before: hk.currentCredits, after: hk.proposedCredits })}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-[var(--r-sm)] border border-line bg-surface-2 px-3 py-2 text-sm text-ink2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink4">{t('housekeeping.assignWorkspace.autoBalance.travel')}</p>
                <p className="mt-1 font-mono">{t('housekeeping.assignWorkspace.autoBalance.floorChanges', { before: preview.floorChangesBefore, after: preview.floorChangesAfter })}</p>
              </div>

              {excludedStaff.length > 0 && (
                <div className="rounded-[var(--r-sm)] border border-line bg-surface-2 px-3 py-2 text-xs text-ink2">
                  <p className="font-medium text-ink">{t('housekeeping.assignWorkspace.autoBalance.excluded', { count: excludedStaff.length })}</p>
                  <ul className="mt-1 space-y-0.5">
                    {excludedStaff.map((staff) => <li key={staff.id}>{nameById[staff.id] ?? staff.id} — {t(`housekeeping.assignWorkspace.autoBalance.exclusion.${staff.reason}`)}</li>)}
                  </ul>
                </div>
              )}

              {preview.changes.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink4">{t('housekeeping.assignWorkspace.autoBalance.changes')}</p>
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                    {preview.changes.map((change) => (
                      <li key={change.roomId} className="flex items-center gap-2 text-xs text-ink2">
                        <span className="font-mono font-semibold text-ink">{change.roomNumber}</span>
                        <span>{change.fromLabel} → {change.toLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button variant="ghost" onClick={() => { setPreview(null); onClose() }}>{t('housekeeping.assignmentSuggestions.cancel')}</Button>
                <Button variant="primary" onClick={stagePlan}>{t('housekeeping.assignWorkspace.autoBalance.stagePlan')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
