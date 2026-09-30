'use client'

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { Button } from '@/components/ui/Button'
import type { StagedChangeEntry } from '@/lib/housekeeping/assignmentView'

interface Props {
  isOpen: boolean
  onClose: () => void
  changes: StagedChangeEntry[]
  onUndo: (roomId: string) => void
  onDiscardAll: () => void
}

/** Review-before-publish panel — every staged room, its from/to, and a per-row undo. */
export function StagedChangesPanel({ isOpen, onClose, changes, onUndo, onDiscardAll }: Props) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(panelRef, isOpen, onClose)

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-drawer bg-stone-900/30 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('housekeeping.assignWorkspace.staged.title')}
        className="fixed right-0 top-0 z-drawer flex h-full w-[380px] max-w-full flex-col border-l border-line bg-surface shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t('housekeeping.assignWorkspace.staged.title')}</h2>
            <p className="mt-0.5 text-xs text-ink3">{t('housekeeping.assignWorkspace.staged.count', { count: changes.length })}</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="shrink-0 p-1.5" aria-label={t('housekeeping.assignmentSuggestions.closeAria')}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {changes.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink3">{t('housekeeping.assignWorkspace.staged.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {changes.map((change) => (
                <li key={change.roomId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-ink">{change.roomNumber}</p>
                    <p className="mt-0.5 truncate text-xs text-ink3">{change.fromLabel} → {change.toLabel}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => onUndo(change.roomId)}>
                    {t('housekeeping.assignWorkspace.staged.undo')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {changes.length > 0 && (
          <div className="shrink-0 border-t border-line px-5 py-3">
            <Button variant="ghost" className="w-full text-[var(--alert)]" onClick={onDiscardAll}>
              {t('housekeeping.assignWorkspace.staged.discardAll')}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
