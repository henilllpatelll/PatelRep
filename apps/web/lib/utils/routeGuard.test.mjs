import assert from 'node:assert/strict'
import test from 'node:test'
import { getAppRoleFromSources, getRouteAccessDecision, toAppRole } from './routeGuard.ts'

test('allows visitors to view the public landing page', () => {
  assert.deepEqual(
    getRouteAccessDecision({
      pathname: '/',
      isAuthenticated: false,
      hasHotel: false,
      role: null,
    }),
    { type: 'allow' },
  )
})

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

// housekeeper/engineer are MOBILE_ONLY_ROLES — blocked from every web portal route
// (including /tasks and /guest-requests) independent of ROLE_ROUTE_RULES; unaffected
// by the Guest Requests/Tasks merge, asserted here only so a future change to that
// gate doesn't silently break these two roles' one remaining route (the mobile-app nudge).
test('allows every non-mobile-only role to reach the legacy /guest-requests route so it can redirect into /tasks', () => {
  for (const role of ['gm', 'housekeeping_supervisor', 'front_desk', 'chief_engineer']) {
    assert.deepEqual(
      getRouteAccessDecision({
        pathname: '/guest-requests',
        isAuthenticated: true,
        hasHotel: true,
        role,
      }),
      { type: 'allow' },
    )
  }
})

test('mobile-only roles are still redirected to login even for the legacy /guest-requests route', () => {
  for (const role of ['housekeeper', 'engineer']) {
    assert.deepEqual(
      getRouteAccessDecision({
        pathname: '/guest-requests',
        isAuthenticated: true,
        hasHotel: true,
        role,
      }),
      { type: 'redirect', pathname: '/login', mobileOnly: true },
    )
  }
})

test('allows non-mobile-only roles to reach the unified /tasks screen', () => {
  for (const role of ['gm', 'housekeeping_supervisor', 'front_desk', 'chief_engineer']) {
    assert.deepEqual(
      getRouteAccessDecision({
        pathname: '/tasks',
        isAuthenticated: true,
        hasHotel: true,
        role,
      }),
      { type: 'allow' },
    )
  }
})
