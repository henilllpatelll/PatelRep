import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOME_SECTIONS,
  SETTINGS_DESTINATIONS,
  SETTINGS_GROUPS,
  SETTINGS_SEARCH_ENTRIES,
  canAccessSettings,
  getDestination,
  getLegacySettingsRedirect,
  getSettingsHref,
  getVisibleDestinations,
  nextListIndex,
  resolveActiveDestination,
  searchSettings,
} from './navigation'
import { getRouteAccessDecision } from '../utils/routeGuard'

const ROLES = ['gm', 'housekeeping_supervisor', 'housekeeper', 'engineer', 'chief_engineer', 'front_desk'] as const

test('groups destinations in the agreed information architecture', () => {
  const grouped = SETTINGS_GROUPS.map((group) => ({
    group: group.label,
    items: SETTINGS_DESTINATIONS.filter((d) => d.group === group.id).map((d) => d.label),
  })).filter((g) => g.items.length > 0)

  assert.deepEqual(grouped, [
    { group: 'Overview', items: ['Settings Home'] },
    { group: 'Property', items: ['Property Profile', 'Rooms & Accessibility'] },
    { group: 'Operations', items: ['Housekeeping', 'Inspections', 'Service SLAs'] },
    { group: 'People & Access', items: ['Roles & Access'] },
    { group: 'Connected Systems', items: ['Integrations'] },
    { group: 'Account', items: ['Billing'] },
    { group: 'Advanced', items: ['Staff Feedback', 'Activity & Audit'] },
  ])
})

test('Settings Home lists every configuration area from the brief', () => {
  const labels = HOME_SECTIONS.map((s) => ({
    section: s.label,
    items: s.destinationIds.map((id) => getDestination(id)?.label),
  }))
  assert.deepEqual(labels, [
    { section: 'Property & Operations', items: ['Property Profile', 'Rooms & Accessibility', 'Housekeeping', 'Inspections', 'Service SLAs'] },
    { section: 'Administration', items: ['Roles & Access', 'Integrations', 'Billing', 'Activity & Audit'] },
  ])
})

test('every destination has a unique id and href and is linkable', () => {
  assert.equal(new Set(SETTINGS_DESTINATIONS.map((d) => d.id)).size, SETTINGS_DESTINATIONS.length)
  assert.equal(new Set(SETTINGS_DESTINATIONS.map((d) => d.href)).size, SETTINGS_DESTINATIONS.length)
  const unlinked = SETTINGS_DESTINATIONS.filter((d) => getSettingsHref(d) === null).map((d) => d.id)
  assert.deepEqual(unlinked, [])
})

test('every search entry points at a real, linkable destination', () => {
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    const dest = getDestination(entry.destinationId)
    assert.ok(dest, `unknown destination for ${entry.id}`)
    assert.equal(dest.planned, undefined, `${entry.id} targets a planned destination`)
    const base = entry.href.split('?')[0]
    const owner = resolveActiveDestination(base)
    assert.equal(owner?.id, dest.id, `${entry.id} href ${entry.href} resolves to ${owner?.id}`)
  }
})

test('highlights the active destination, including legacy and related pages', () => {
  assert.equal(resolveActiveDestination('/settings')?.id, 'home')
  assert.equal(resolveActiveDestination('/settings/')?.id, 'home')
  assert.equal(resolveActiveDestination('/settings/general')?.id, 'general')
  assert.equal(resolveActiveDestination('/settings/guest-requests')?.id, 'sla')
  assert.equal(resolveActiveDestination('/settings/roles')?.id, 'roles')
  assert.equal(resolveActiveDestination('/settings/front-desk')?.id, 'roles')
  assert.equal(resolveActiveDestination('/settings/departments')?.id, 'roles')
  assert.equal(resolveActiveDestination('/settings/rooms/anything')?.id, 'rooms')
  assert.equal(resolveActiveDestination('/settings/unknown'), undefined)
})

test('legacy bookmarks that moved to top-level routes are redirected, not dropped', () => {
  assert.equal(getLegacySettingsRedirect('/settings/programs'), '/programs')
  assert.equal(getLegacySettingsRedirect('/settings/sop'), '/sop')
  assert.equal(getLegacySettingsRedirect('/settings/sop/'), '/sop')
  assert.equal(getLegacySettingsRedirect('/settings/general'), null)
})

test('every pre-redesign settings route still resolves somewhere', () => {
  const legacy = [
    '/settings', '/settings/general', '/settings/rooms', '/settings/front-desk', '/settings/inspections',
    '/settings/guest-requests', '/settings/housekeeping', '/settings/programs', '/settings/sop',
    '/settings/departments', '/settings/roles', '/settings/integrations', '/settings/billing', '/settings/feedback',
  ]
  for (const path of legacy) {
    assert.ok(getLegacySettingsRedirect(path) || resolveActiveDestination(path), `${path} is orphaned`)
  }
})

test('search maps common terms to the right destination', () => {
  const top = (q: string) => searchSettings(q, 'gm')[0]
  assert.equal(top('credits')?.id, 'housekeeping-workload')
  assert.equal(top('credits')?.href, '/settings/housekeeping?tab=workload')
  assert.equal(top('room')?.destinationId, 'rooms')
  assert.equal(top('front desk access')?.destinationId, 'roles')
  assert.equal(top('front desk access')?.href, '/settings/roles?access=front-desk')
  assert.equal(top('opera')?.destinationId, 'integrations')
  assert.equal(top('inspection checklist')?.destinationId, 'inspections')
  assert.equal(top('billing')?.destinationId, 'billing')
  assert.equal(top('ADA')?.destinationId, 'rooms')
})

test('search is forgiving about case, punctuation and spacing', () => {
  assert.equal(searchSettings('  Rooms & Accessibility ', 'gm')[0]?.destinationId, 'rooms')
  assert.equal(searchSettings('OPERA!!', 'gm')[0]?.destinationId, 'integrations')
})

test('search returns nothing for empty and unmatched queries', () => {
  assert.deepEqual(searchSettings('', 'gm'), [])
  assert.deepEqual(searchSettings('   ', 'gm'), [])
  assert.deepEqual(searchSettings('zzzxqv', 'gm'), [])
})

test('Activity & Audit is a real, searchable destination for GMs only', () => {
  assert.equal(searchSettings('audit', 'gm')[0]?.destinationId, 'activity')
  assert.equal(searchSettings('who changed', 'gm').some((r) => r.destinationId === 'activity'), true)
  assert.deepEqual(searchSettings('audit', 'housekeeper'), [])
  assert.equal(getSettingsHref(getDestination('activity')!), '/settings/activity')
})

test('search requires every word to match', () => {
  assert.deepEqual(searchSettings('opera checklist', 'gm'), [])
})

test('Settings stays GM-only: no other role sees destinations or search results', () => {
  assert.equal(canAccessSettings('gm'), true)
  for (const role of ROLES.filter((r) => r !== 'gm')) {
    assert.equal(canAccessSettings(role), false, role)
    assert.deepEqual(getVisibleDestinations(role), [], role)
    assert.deepEqual(searchSettings('billing', role), [], role)
  }
  assert.equal(canAccessSettings(null), false)
  assert.equal(canAccessSettings(undefined), false)
})

test('the global route guard agrees with the Settings access list for every settings URL', () => {
  const paths = ['/settings', ...SETTINGS_DESTINATIONS.map((d) => d.href), '/settings/front-desk', '/settings/programs']
  for (const pathname of paths) {
    for (const role of ROLES) {
      // Mobile-only roles are bounced to /login before route rules apply.
      if (role === 'housekeeper' || role === 'engineer') continue
      const decision = getRouteAccessDecision({ pathname, isAuthenticated: true, hasHotel: true, role })
      assert.equal(decision.type === 'allow', canAccessSettings(role), `${role} ${pathname}`)
    }
  }
})

test('arrow, Home and End keys move through a list and wrap', () => {
  assert.equal(nextListIndex(-1, 'ArrowDown', 4), 0)
  assert.equal(nextListIndex(0, 'ArrowDown', 4), 1)
  assert.equal(nextListIndex(3, 'ArrowDown', 4), 0)
  assert.equal(nextListIndex(0, 'ArrowUp', 4), 3)
  assert.equal(nextListIndex(2, 'ArrowUp', 4), 1)
  assert.equal(nextListIndex(2, 'Home', 4), 0)
  assert.equal(nextListIndex(1, 'End', 4), 3)
  assert.equal(nextListIndex(1, 'a', 4), null)
  assert.equal(nextListIndex(0, 'ArrowDown', 0), null)
})
