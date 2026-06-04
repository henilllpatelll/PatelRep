import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import es from './locales/es'

export type AppLanguage = 'en' | 'es'

export const LANGUAGE_STORAGE_KEY = 'patelrep-language'

export function normalizeLanguage(language: string | null | undefined): AppLanguage {
  return language === 'es' ? 'es' : 'en'
}

const browserLanguage =
  typeof window !== 'undefined'
    ? normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? window.navigator.language)
    : 'en'

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: browserLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  })
}

export default i18n
