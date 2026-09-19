import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const webRoot = resolve(import.meta.dirname, '../..')

test('the retired Copilot route returns users to the dashboard', () => {
  const source = readFileSync(resolve(webRoot, 'app/(dashboard)/ai/page.tsx'), 'utf8')

  assert.match(source, /redirect\(['"]\/dashboard['"]\)/)
})

test('the dashboard does not route staff into the retired Copilot page', () => {
  const source = readFileSync(resolve(webRoot, 'components/dashboard/SimplifiedDashboard.tsx'), 'utf8')

  assert.doesNotMatch(source, /router\.push\(['"]\/ai['"]\)/)
})
