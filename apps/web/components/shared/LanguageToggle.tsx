'use client'

import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGE_STORAGE_KEY, normalizeLanguage, type AppLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

interface LanguageToggleProps {
  className?: string
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { t, i18n } = useTranslation()
  const currentLanguage = normalizeLanguage(i18n.language)
  const nextLanguage: AppLanguage = currentLanguage === 'en' ? 'es' : 'en'
  const nextLabel = nextLanguage === 'es' ? t('common.spanish') : t('common.english')

  const handleToggle = async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
    await i18n.changeLanguage(nextLanguage)
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      data-i18n-skip="true"
      aria-label={nextLabel}
      title={nextLabel}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surface-2 hover:text-ink',
        className,
      )}
    >
      <Languages size={14} className="text-ink3" />
      <span className="font-mono">{currentLanguage === 'en' ? 'ES' : 'EN'}</span>
    </button>
  )
}
