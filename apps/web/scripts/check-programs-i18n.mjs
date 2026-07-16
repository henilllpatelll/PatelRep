import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pagePath = path.join(root, 'app', '(dashboard)', 'programs', 'page.tsx')
const page = fs.readFileSync(pagePath, 'utf8')
const localeFiles = ['en.ts', 'es.ts'].map((name) => path.join(root, 'i18n', 'locales', name))
const translationKeys = [...page.matchAll(/t\('programs\.([^']+)'/g)].map((match) => match[1])

for (const localeFile of localeFiles) {
  const locale = fs.readFileSync(localeFile, 'utf8')
  for (const key of translationKeys) {
    if (!new RegExp(`\\b${key}:`).test(locale)) {
      throw new Error(`Missing programs.${key} in ${path.basename(localeFile)}`)
    }
  }
}

const commonFloorCopy = /(?:>\s*(?:Save|Refresh|Loading|Cancel|Submit)\s*<|(?:placeholder|aria-label)=['"](?:Save|Refresh|Loading|Cancel|Submit))/
if (commonFloorCopy.test(page)) {
  throw new Error('Hardcoded common floor-facing copy found in the operational-program page.')
}

console.log(`Verified ${translationKeys.length} bilingual operational-program keys.`)
