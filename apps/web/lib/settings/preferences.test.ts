import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACCENT_OPTIONS, DENSITY_OPTIONS, LANGUAGE_OPTIONS, PREFERENCES_HREF, THEME_OPTIONS,
  buildProfileRows, canEditProfileInPeople, isLanguageChoice,
} from './preferences'
import { ALL_ROLES, getRouteAccessDecision } from '../utils/routeGuard'
import { canAccessSettings, SETTINGS_DESTINATIONS } from './navigation'
import { useUIPreferencesStore } from '../../stores/uiPreferencesStore'

test('appearance options mirror the values the shared preference store accepts', () => {
  assert.deepEqual(THEME_OPTIONS.map((o) => o.value), ['light', 'dark'])
  assert.deepEqual(DENSITY_OPTIONS.map((o) => o.value), ['comfortable', 'balanced', 'dense'])
  assert.deepEqual(ACCENT_OPTIONS.map((o) => o.value), ['terracotta', 'teal', 'blue', 'rose'])
  assert.deepEqual(LANGUAGE_OPTIONS.map((o) => o.value), ['en', 'es'])
  assert.equal(DENSITY_OPTIONS.find((o) => o.value === 'dense')?.label, 'Compact')
})

test('every option can be applied through the single existing preference store', () => {
  const store = useUIPreferencesStore.getState()
  for (const o of THEME_OPTIONS) { store.setTheme(o.value); assert.equal(useUIPreferencesStore.getState().theme, o.value) }
  for (const o of DENSITY_OPTIONS) { store.setDensity(o.value); assert.equal(useUIPreferencesStore.getState().density, o.value) }
  for (const o of ACCENT_OPTIONS) { store.setAccent(o.value); assert.equal(useUIPreferencesStore.getState().accent, o.value) }
})

test('profile rows show only user-facing fields and skip blanks', () => {
  const rows = buildProfileRows({
    fullName: ' Maria Lopez ', preferredName: 'Mari', email: 'maria@hotel.test', phone: '', roleLabel: 'Front Desk', hotelName: 'Fossil Creek Inn',
  })
  assert.deepEqual(rows.map((r) => [r.id, r.value]), [
    ['name', 'Maria Lopez'], ['preferred', 'Mari'], ['email', 'maria@hotel.test'], ['role', 'Front Desk'], ['hotel', 'Fossil Creek Inn'],
  ])
  assert.equal(rows.some((r) => /id$/i.test(r.id)), false)
})

test('a preferred name that repeats the full name is not shown twice', () => {
  const rows = buildProfileRows({ fullName: 'Sam Patel', preferredName: 'sam patel' })
  assert.deepEqual(rows.map((r) => r.id), ['name'])
  assert.deepEqual(buildProfileRows({}), [])
})

test('only a GM is pointed at the Staff page to change profile details', () => {
  assert.equal(canEditProfileInPeople('gm'), true)
  for (const role of ALL_ROLES.filter((r) => r !== 'gm')) assert.equal(canEditProfileInPeople(role), false, role)
  assert.equal(canEditProfileInPeople(null), false)
})

test('language values are validated', () => {
  assert.equal(isLanguageChoice('en'), true)
  assert.equal(isLanguageChoice('es'), true)
  assert.equal(isLanguageChoice('fr'), false)
  assert.equal(isLanguageChoice(undefined), false)
})

test('My Preferences is open to every signed-in web role and does not grant Settings access', () => {
  assert.equal(PREFERENCES_HREF, '/preferences')
  for (const role of ALL_ROLES) {
    if (role === 'housekeeper' || role === 'engineer') continue // mobile-only roles never reach the web portal
    const decision = getRouteAccessDecision({ pathname: PREFERENCES_HREF, isAuthenticated: true, hasHotel: true, role })
    assert.equal(decision.type, 'allow', role)
    if (role !== 'gm') assert.equal(canAccessSettings(role), false, role)
  }
})

test('My Preferences still requires a session and a property', () => {
  const anon = getRouteAccessDecision({ pathname: PREFERENCES_HREF, isAuthenticated: false, hasHotel: false, role: null })
  assert.equal(anon.type, 'redirect')
  assert.equal(anon.type === 'redirect' && anon.pathname, '/login')
})

test('personal preferences are not a property Settings destination', () => {
  assert.equal(SETTINGS_DESTINATIONS.some((d) => d.href.includes('preferences')), false)
})
