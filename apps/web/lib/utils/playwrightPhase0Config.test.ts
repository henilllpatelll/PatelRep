import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('phase0 smoke dev server avoids Turbopack next/font/google resolution failure', () => {
  const source = readFileSync(new URL('../../playwright.phase0.config.ts', import.meta.url), 'utf8')
  assert.match(source, /npm run dev -- --webpack /)
})
