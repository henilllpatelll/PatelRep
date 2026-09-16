'use client'

import { MessageSquare, ClipboardList, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/ui/Button'

/** First step of "+ New Task": pick which of the two underlying domains this belongs to.
 * Neither option is exposed as raw domain language — just "a guest needs something" vs
 * "internal work" — PatelRep handles the guest_request/task split underneath. */
export function NewTaskChooser({ onClose, onPickGuest, onPickInternal }: {
  onClose: () => void
  onPickGuest: () => void
  onPickInternal: () => void
}) {
  const { t } = useTranslation()

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="new-task-chooser-title" className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div className="bg-surface/[0.92] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h2 id="new-task-chooser-title" className="text-base font-semibold text-ink">{t('tasks.unified.chooserTitle')}</h2>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.createModal.closeAria')} className="text-ink3 hover:text-ink2"><X size={18} /></IconButton>
        </div>
        <div className="p-4 space-y-2.5">
          <button
            type="button"
            onClick={onPickGuest}
            className="w-full flex items-start gap-3 rounded-[var(--r-md)] border border-line px-4 py-3.5 text-left hover:bg-surface-2 hover:border-[var(--accent-line)] transition-colors"
          >
            <MessageSquare size={18} className="text-[var(--accent)] shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-ink">{t('tasks.unified.chooserGuestTitle')}</span>
              <span className="block text-xs text-ink3 mt-0.5">{t('tasks.unified.chooserGuestSubtitle')}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={onPickInternal}
            className="w-full flex items-start gap-3 rounded-[var(--r-md)] border border-line px-4 py-3.5 text-left hover:bg-surface-2 hover:border-[var(--accent-line)] transition-colors"
          >
            <ClipboardList size={18} className="text-[var(--accent)] shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-ink">{t('tasks.unified.chooserInternalTitle')}</span>
              <span className="block text-xs text-ink3 mt-0.5">{t('tasks.unified.chooserInternalSubtitle')}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
