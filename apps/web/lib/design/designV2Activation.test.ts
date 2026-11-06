import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DESIGN_V2_CONTEXT_MAX_AGE_MS,
  DESIGN_V2_FLAG,
  resolveTenantDesignV2,
  type DesignV2ContextInput,
} from './designV2Activation'
import { isDesignV2Enabled, isDesignV2PreviewEnabled, resolveDesignV2Preview } from './designV2'
import { useAuthStore } from '../../stores/authStore'
import { useHotelStore, type Hotel } from '../../stores/hotelStore'
import { useUIPreferencesStore } from '../../stores/uiPreferencesStore'

const NOW = 1_800_000_000_000
const WEB_ROOT = resolve(__dirname, '..', '..')

const hotel = (id: string, features: string[] | undefined): Hotel => ({
  id,
  name: `Hotel ${id}`,
  timezone: 'America/Chicago',
  room_count: 80,
  enabled_features: features,
})
const input = (over: Partial<DesignV2ContextInput> = {}): DesignV2ContextInput => ({
  authUserId: 'u1',
  hotel: hotel('A', [DESIGN_V2_FLAG]),
  contextUserId: 'u1',
  contextHotelId: 'A',
  contextFetchedAt: NOW - 1000,
  now: NOW,
  ...over,
})
const signIn = (id: string) => useAuthStore.setState({ user: { id } as never })
const applyContext = (userId: string, h: Hotel, fetchedAt = Date.now()) =>
  useHotelStore.getState().setContext({ hotel: h, userId, fetchedAt })

const savedEnv = { ...process.env }
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_DESIGN_V2_PREVIEW
  delete process.env.NEXT_PUBLIC_APP_ENV
  useAuthStore.setState({ user: null })
  useHotelStore.getState().clear()
})
afterEach(() => {
  process.env = { ...savedEnv }
})

// ── pure decision ────────────────────────────────────────────────────────────────────────────────────────
test('default OFF: no flag, no context, no user', () => {
  assert.equal(resolveTenantDesignV2(input({ hotel: hotel('A', undefined) })), false)
  assert.equal(resolveTenantDesignV2(input({ hotel: hotel('A', []) })), false)
  assert.equal(resolveTenantDesignV2(input({ hotel: null })), false)
  assert.equal(resolveTenantDesignV2(input({ authUserId: null })), false)
  assert.equal(resolveTenantDesignV2(input({ contextFetchedAt: null })), false)
})

test('flag ON for the signed-in user and hotel with a fresh read', () => {
  assert.equal(resolveTenantDesignV2(input()), true)
})

test('only the exact registered key counts', () => {
  assert.equal(resolveTenantDesignV2(input({ hotel: hotel('A', ['design_v2_preview', 'Design_V2', 'hk_ai_assistant']) })), false)
})

test('another user or another hotel context never counts (account/hotel switch fails closed)', () => {
  assert.equal(resolveTenantDesignV2(input({ contextUserId: 'someone-else' })), false)
  assert.equal(resolveTenantDesignV2(input({ contextHotelId: 'B' })), false)
  assert.equal(resolveTenantDesignV2(input({ contextUserId: null, contextHotelId: null })), false)
})

test('a stale or future-dated read fails closed, a read just inside the window counts', () => {
  assert.equal(resolveTenantDesignV2(input({ contextFetchedAt: NOW - DESIGN_V2_CONTEXT_MAX_AGE_MS })), true)
  assert.equal(resolveTenantDesignV2(input({ contextFetchedAt: NOW - DESIGN_V2_CONTEXT_MAX_AGE_MS - 1 })), false)
  assert.equal(resolveTenantDesignV2(input({ contextFetchedAt: NOW + 60_000 })), false)
  assert.equal(resolveTenantDesignV2(input({ contextFetchedAt: Number.NaN })), false)
})

// ── development preview isolation + production safety ────────────────────────────────────────────────────
test('preview fails closed: needs the flag AND an explicit non-production environment', () => {
  assert.equal(resolveDesignV2Preview(undefined, 'development'), false)
  assert.equal(resolveDesignV2Preview('false', 'development'), false)
  assert.equal(resolveDesignV2Preview('true', 'development'), true)
  assert.equal(resolveDesignV2Preview('TRUE ', 'staging'), true)
  assert.equal(resolveDesignV2Preview('true', 'test'), true)
  assert.equal(resolveDesignV2Preview('true', 'production'), false)
  assert.equal(resolveDesignV2Preview('true', ' Production '), false)
  assert.equal(resolveDesignV2Preview('true', 'prod'), false)
  assert.equal(resolveDesignV2Preview('true', 'anything-else'), false)
  // Unset environment (the old fail-OPEN case): only the local dev server qualifies.
  assert.equal(resolveDesignV2Preview('true', undefined), false)
  assert.equal(resolveDesignV2Preview('true', '', 'production'), false)
  assert.equal(resolveDesignV2Preview('true', undefined, 'development'), true)
})

test('a stray preview flag in a production build does not enable V2 for anyone', () => {
  process.env.NEXT_PUBLIC_DESIGN_V2_PREVIEW = 'true'
  process.env.NEXT_PUBLIC_APP_ENV = 'production'
  signIn('u1')
  applyContext('u1', hotel('A', []))
  assert.equal(isDesignV2PreviewEnabled(), false)
  assert.equal(isDesignV2Enabled(), false)
})

test('the production environment variable does not block a properly authorized tenant rollout', () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'production'
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
})

test('development preview works without any tenant context and is separate from activation', () => {
  process.env.NEXT_PUBLIC_DESIGN_V2_PREVIEW = 'true'
  process.env.NEXT_PUBLIC_APP_ENV = 'development'
  assert.equal(isDesignV2Enabled(), true)
  assert.equal(isDesignV2PreviewEnabled(), true)
})

test('the tenant flag never turns on the preview-only surfaces', () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
  assert.equal(isDesignV2PreviewEnabled(), false)
})

// ── against the real stores ──────────────────────────────────────────────────────────────────────────────
test('login / logout: nothing before login, cleared after logout', () => {
  assert.equal(isDesignV2Enabled(), false)
  signIn('u1')
  assert.equal(isDesignV2Enabled(), false, 'signed in but context not read yet -> legacy')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
  useAuthStore.getState().clear()
  assert.equal(isDesignV2Enabled(), false, 'auth cleared first -> legacy immediately')
  useHotelStore.getState().clear()
  assert.equal(useHotelStore.getState().contextFetchedAt, null)
  signIn('u1')
  assert.equal(isDesignV2Enabled(), false, 'signing back in does not resurrect the old enabled state')
})

test("account switching: the previous person's enabled hotel does not leak to the next person", () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
  signIn('u2')
  assert.equal(isDesignV2Enabled(), false)
  applyContext('u2', hotel('B', []))
  assert.equal(isDesignV2Enabled(), false)
})

test('two hotels with different states', () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
  applyContext('u1', hotel('B', []))
  assert.equal(isDesignV2Enabled(), false)
  applyContext('u1', hotel('C', ['hk_ai_assistant']))
  assert.equal(isDesignV2Enabled(), false)
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
})

test('hotel switching without a fresh read fails closed', () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  // Another code path sets a different hotel record that carries the flag but was never read for it.
  useHotelStore.getState().setHotel(hotel('B', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), false)
})

test('local edits to the same hotel keep the decision (settings save spreads the hotel)', () => {
  signIn('u1')
  const a = hotel('A', [DESIGN_V2_FLAG])
  applyContext('u1', a)
  useHotelStore.getState().setHotel({ ...a, name: 'Renamed' })
  assert.equal(isDesignV2Enabled(), true)
})

test('refresh behavior: ON -> OFF is observed after a refresh, OFF -> ON too', () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
  applyContext('u1', hotel('A', [])) // Feature Rollout enabled=false, then the next /auth/me
  assert.equal(isDesignV2Enabled(), false)
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  assert.equal(isDesignV2Enabled(), true)
})

test('API failure after ON: the last good read is trusted only until it ages out (offline fallback)', () => {
  signIn('u1')
  const readAt = Date.now() - 10 * 60 * 1000
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]), readAt)
  assert.equal(isDesignV2Enabled(readAt + 10 * 60 * 1000), true)
  assert.equal(isDesignV2Enabled(readAt + DESIGN_V2_CONTEXT_MAX_AGE_MS + 1), false)
})

test('API failure from the start: no context, legacy', () => {
  signIn('u1')
  assert.equal(isDesignV2Enabled(), false)
})

test('light and dark appearance does not change the activation decision', () => {
  signIn('u1')
  applyContext('u1', hotel('A', [DESIGN_V2_FLAG]))
  for (const theme of ['light', 'dark'] as const) {
    useUIPreferencesStore.setState({ theme })
    assert.equal(isDesignV2Enabled(), true, theme)
  }
  useHotelStore.getState().clear()
  for (const theme of ['light', 'dark'] as const) {
    useUIPreferencesStore.setState({ theme })
    assert.equal(isDesignV2Enabled(), false, theme)
  }
})

// ── wiring contracts (source) ────────────────────────────────────────────────────────────────────────────
const read = (rel: string) => readFileSync(resolve(WEB_ROOT, rel), 'utf8')

test('only the sign-in page and the preview route stay on the preview-only switch', () => {
  const out = execFileSync('git', ['grep', '-l', 'isDesignV2PreviewEnabled', '--', 'app', 'components'], {
    cwd: WEB_ROOT,
    encoding: 'utf8',
  })
  const files = out.split('\n').filter(Boolean).sort()
  assert.deepEqual(files, ['app/(auth)/login/page.tsx', 'app/design-v2-preview/page.tsx'])
})

test('the shell subscribes reactively and the auth listener scopes, refreshes and clears the context', () => {
  const shell = read('components/shared/DashboardShell.tsx')
  assert.match(shell, /useDesignV2\(\)/)
  assert.doesNotMatch(shell, /isDesignV2PreviewEnabled/)
  const providers = read('components/shared/Providers.tsx')
  assert.match(providers, /setContext\(\{ hotel: data\.hotel/)
  assert.match(providers, /useAuthStore\.getState\(\)\.user\?\.id !== session\.user\.id\) clearHotel\(\)/)
  assert.match(providers, /visibilitychange/)
  assert.match(providers, /addEventListener\('online'/)
  assert.match(providers, /fetchProfile\(true\)/)
})

test('the flag grants nothing: no guard, middleware or API client reads it', () => {
  for (const rel of ['proxy.ts', 'middleware.ts', 'lib/utils/routeGuard.ts', 'lib/api/client.ts'].filter((f) => existsSync(resolve(WEB_ROOT, f)))) {
    assert.doesNotMatch(read(rel), /design_v2|isDesignV2|designV2Activation/, rel)
  }
})
