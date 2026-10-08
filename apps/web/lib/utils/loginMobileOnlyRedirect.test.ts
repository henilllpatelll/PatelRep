import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../app/(auth)/login/page.tsx', import.meta.url), 'utf8')

test('password login sends mobile-only roles to /login?mobileOnly=1 after sign-out', () => {
  const block = source.slice(source.indexOf('MOBILE_ONLY_ROLES.has(userRole)'))
  const branch = block.slice(0, block.indexOf('return'))
  assert.match(branch, /signOut\(\)/)
  assert.match(branch, /window\.location\.assign\('\/login\?mobileOnly=1'\)/)
})
