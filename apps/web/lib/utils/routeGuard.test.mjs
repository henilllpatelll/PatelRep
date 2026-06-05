import assert from 'node:assert/strict'
import test from 'node:test'
import { getAppRoleFromSources, getRouteAccessDecision, toAppRole } from './routeGuard.ts'

test('allows authenticated users without a resolved app role to reach dashboard', () => {
  assert.deepEqual(
    getRouteAccessDecision({
      pathname: '/dashboard',
      isAuthenticated: true,
      hasHotel: true,
      role: null,
    }),
    { type: 'allow' },
  )
})

test('normalizes Supabase database roles as unresolved app roles', () => {
  assert.equal(toAppRole('authenticated'), null)
  assert.equal(toAppRole('anon'), null)
  assert.equal(toAppRole('gm'), 'gm')

  assert.deepEqual(
    getRouteAccessDecision({
      pathname: '/dashboard',
      isAuthenticated: true,
      hasHotel: true,
      role: toAppRole('authenticated'),
    }),
    { type: 'allow' },
  )
})

test('uses the first valid PatelRep role from fallback sources', () => {
  assert.equal(getAppRoleFromSources('gm', 'authenticated'), 'gm')
  assert.equal(getAppRoleFromSources('authenticated', undefined, 'gm'), 'gm')
  assert.equal(getAppRoleFromSources('anon', 'engineer', 'gm'), 'engineer')
  assert.equal(getAppRoleFromSources('authenticated', 'viewer'), null)
})

test('redirects authenticated users without a resolved app role away from restricted routes', () => {
  assert.deepEqual(
    getRouteAccessDecision({
      pathname: '/staff',
      isAuthenticated: true,
      hasHotel: true,
      role: null,
    }),
    { type: 'redirect', pathname: '/dashboard', unauthorized: '/staff' },
  )
})

test('redirects unauthenticated users to login with the intended path', () => {
  assert.deepEqual(
    getRouteAccessDecision({
      pathname: '/reports',
      isAuthenticated: false,
      hasHotel: false,
      role: null,
    }),
    { type: 'redirect', pathname: '/login', redirectTo: '/reports' },
  )
})
