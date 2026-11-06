import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import en from '../../i18n/locales/en'
import es from '../../i18n/locales/es'

/** A literal `t('a.b')` whose key does not exist renders the raw key to the user ("common.notes" as a field label). The EN/ES parity gate
 *  only compares the two files with each other, so it cannot see a key that neither file defines. */
const webRoot = path.resolve(__dirname, '..', '..')
const get = (obj: unknown, key: string): unknown => key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), obj)
const defined = (obj: unknown, key: string) => ['', '_one', '_other', '_zero', '_few', '_many'].some((suffix) => typeof get(obj, key + suffix) === 'string')

const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'e2e') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(full)
  }
}
for (const dir of ['components', 'app', 'lib']) walk(path.join(webRoot, dir))

test('every literal t() key resolves in EN and ES (plural forms and explicit defaults allowed)', () => {
  const unresolved: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(/\bt\(\s*['"`]([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"`]\s*([,)])/g)) {
      const key = match[1]
      const hasDefault = match[2] === ',' && /^\s*,\s*['"`]/.test(src.slice(match.index! + match[0].length - 1, match.index! + match[0].length + 40))
      if (hasDefault) continue
      for (const [name, locale] of [['en', en], ['es', es]] as const) {
        if (!defined(locale, key)) unresolved.push(`${name}: ${key} <- ${path.relative(webRoot, file)}`)
      }
    }
  }
  assert.deepEqual(unresolved, [])
})
