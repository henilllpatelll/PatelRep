'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'

interface Props {
  onKeepEditing: () => void
  onDiscard: () => void
}

/** Inline confirmation shown at the foot of a drawer (a confirmation is not a second drawer).
 *  It takes focus on the safe choice, and Escape means "keep editing", never "discard". */
export function DiscardChangesPrompt({ onKeepEditing, onDiscard }: Props) {
  const { t } = useTranslation()
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    keepRef.current?.focus()
  }, [])

  return (
    <div
      role="alertdialog"
      aria-labelledby="discard-changes-title"
      aria-describedby="discard-changes-help"
      className="border-t border-line bg-[var(--caution-soft)] px-4 py-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onKeepEditing()
        }
      }}
    >
      <p id="discard-changes-title" className="text-sm font-semibold text-ink">{t('common.discardChanges.title')}</p>
      <p id="discard-changes-help" className="mt-0.5 text-xs text-ink2">{t('common.discardChanges.help')}</p>
      <div className="mt-3 flex gap-2">
        <Button ref={keepRef} type="button" variant="primary" size="sm" onClick={onKeepEditing}>{t('common.discardChanges.keep')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>{t('common.discardChanges.discard')}</Button>
      </div>
    </div>
  )
}
