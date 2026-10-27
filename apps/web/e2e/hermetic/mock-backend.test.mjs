import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { HERMETIC_PASSWORD, HERMETIC_USERS, route } from './mock-backend.mjs'

const query = (q = '') => new URLSearchParams(q)

test('the mock holds only synthetic fixtures and logs a user in solely with the fixture password', () => {
  const ok = route({ method: 'POST', path: '/auth/v1/token', query: query('grant_type=password'), body: { email: 'gm@hermetic.invalid', password: HERMETIC_PASSWORD } })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.user.app_metadata.role, 'gm')
  assert.equal(route({ method: 'POST', path: '/auth/v1/token', query: query('grant_type=password'), body: { email: 'gm@hermetic.invalid', password: 'wrong' } }).status, 400)
  assert.equal(route({ method: 'POST', path: '/auth/v1/token', query: query('grant_type=password'), body: { email: 'real.person@example.com', password: HERMETIC_PASSWORD } }).status, 400)
  assert.deepEqual(Object.keys(HERMETIC_USERS), ['gm@hermetic.invalid', 'supervisor@hermetic.invalid'])
})

test('the board fixture covers every status, deterministically, with no clock-derived values', () => {
  const first = route({ method: 'GET', path: '/v1/housekeeping/board', query: query(), email: 'gm@hermetic.invalid' }).json.data
  const second = route({ method: 'GET', path: '/v1/housekeeping/board', query: query(), email: 'gm@hermetic.invalid' }).json.data
  assert.deepEqual(first, second)
  assert.deepEqual(first.map((r) => [r.rooms.room_number, r.status]), [['101', 'DIRTY'], ['102', 'CLEAN'], ['103', 'INSPECTED'], ['104', 'IN_PROGRESS'], ['105', 'PICKUP'], ['106', 'OCCUPIED'], ['107', 'OOO']])
  assert.doesNotMatch(JSON.stringify(first), new RegExp(String(new Date().getFullYear() + 1)))
})

test('unauthenticated /auth/v1/user is rejected so the route guard behaves like production', () => {
  assert.equal(route({ method: 'GET', path: '/auth/v1/user', query: query(), email: null }).status, 401)
  assert.equal(route({ method: 'GET', path: '/v1/unknown/thing', query: query(), email: 'gm@hermetic.invalid' }).fallback, true)
  assert.equal(route({ method: 'GET', path: '/elsewhere', query: query(), email: null }), null)
})

test('the Playwright config and the mock agree on the synthetic password and never reference real secrets', () => {
  const config = readFileSync(new URL('../../playwright.hermetic.config.ts', import.meta.url), 'utf8')
  assert.ok(config.includes(`const HERMETIC_PASSWORD = '${HERMETIC_PASSWORD}'`))
  assert.doesNotMatch(config + readFileSync(new URL('./run.mjs', import.meta.url), 'utf8') + readFileSync(new URL('./mock-backend.mjs', import.meta.url), 'utf8'), /secrets\.|SERVICE_ROLE|STRIPE|process\.env\.(REGRESSION_[A-Z_]+|SUPABASE_SERVICE)\s*(\?\?|\|\|)\s*process/)
})
