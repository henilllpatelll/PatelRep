'use client'

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import '@/i18n'
import { LANGUAGE_STORAGE_KEY, normalizeLanguage } from '@/i18n'
import { installDomTranslator, translateDom } from '@/i18n/domTranslations'

export function LanguageSync({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()
  const language = normalizeLanguage(i18n.language)

  useEffect(() => {
    document.documentElement.lang = language
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    translateDom(document.body, language)
  }, [language])

  useEffect(() => installDomTranslator(language), [language])

  return <>{children}</>
}
