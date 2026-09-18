import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_NAV_ITEMS,
  BRAND_NAV_HREFS,
  CONTEXTUAL_NAV_HREFS,
  DIRECT_ACCESS_NAV_HREFS,
  getAllowedNavItems,
  MORE_NAV_HREFS,
  PRIMARY_NAV_HREFS,
  SETTINGS_NAV_ITEM,
} from './navigation'
import baseline from './navigation.matrix.json' with { type: 'json' }

// The 6 base (non-custom) roles. Per-hotel custom roles (migrations 028/029)
// and hotel-customized front_desk_modules are NOT statically enumerable here
// and are asserted at runtime elsewhere — this matrix covers the DEFAULT
// front-desk module set (DEFAULT_FRONT_DESK_MODULES) only, so it is a
// baseline for the 6 base roles, not a total enumeration of every possible
// allow-set.
const ROLES = ['gm', 'housekeeping_supervisor', 'housekeeper', 'engineer', 'chief_engineer', 'front_desk'] as const

function buildMatrix(): Record<string, string[]> {
  const matrix: Record<string, string[]> = {}
  for (const role of ROLES) {
    matrix[role] = getAllowedNavItems({ role, customRoleModules: null, frontDeskModules: null }).map((i) => i.href)
  }
  return matrix
}

test('6-role nav allow-set matches the committed baseline snapshot', () => {
  assert.deepEqual(buildMatrix(), baseline)
})

test('every allowed href for every role is primary, in More, direct-accessible, or reachable from its workspace', () => {
  const grouped = new Set([
    ...PRIMARY_NAV_HREFS,
    ...MORE_NAV_HREFS,
    ...BRAND_NAV_HREFS,
    ...CONTEXTUAL_NAV_HREFS,
    ...DIRECT_ACCESS_NAV_HREFS,
    '/settings',
  ])
  const matrix = buildMatrix()
  for (const role of ROLES) {
    const ungrouped = matrix[role].filter((href) => !grouped.has(href))
    assert.deepEqual(ungrouped, [], `role "${role}" has allowed hrefs missing from the navigation model: ${ungrouped.join(', ')}`)
  }
})

test('keeps core workspaces primary while demoting secondary records to More', () => {
  assert.deepEqual(PRIMARY_NAV_HREFS, [
    '/housekeeping', '/engineering', '/tasks',
  ])
  assert.deepEqual(MORE_NAV_HREFS, [
    '/lost-found', '/reports', '/staff', '/logbook',
  ])
  assert.deepEqual(CONTEXTUAL_NAV_HREFS, ['/scheduling', '/management-roi'])
})

test('reaches Dashboard through the PatelRep brand link instead of the sidebar', () => {
  assert.deepEqual(BRAND_NAV_HREFS, ['/dashboard'])
  assert.equal(PRIMARY_NAV_HREFS.includes('/dashboard'), false)
  assert.equal(MORE_NAV_HREFS.includes('/dashboard'), false)
  assert.ok(getAllowedNavItems({ role: 'gm' }).some((item) => item.href === '/dashboard'))
})

test('presents People as one workspace and removes engineering sub-navigation', () => {
  const people = ALL_NAV_ITEMS.find((item) => item.href === '/staff')
  const engineering = ALL_NAV_ITEMS.find((item) => item.href === '/engineering')

  assert.equal(people?.label, 'People')
  assert.equal(engineering?.subNav, undefined)
})

test('places Programs and SOP Library in Settings instead of the primary sidebar', () => {
  assert.equal(PRIMARY_NAV_HREFS.includes('/programs'), false)
  assert.deepEqual(
    SETTINGS_NAV_ITEM.subNav?.find((item) => item.href === '/settings/programs'),
    { href: '/settings/programs', label: 'Programs' },
  )
  assert.deepEqual(
    SETTINGS_NAV_ITEM.subNav?.find((item) => item.href === '/settings/sop'),
    { href: '/settings/sop', label: 'SOP Library' },
  )
})

test('keeps supplemental pages direct-accessible without sidebar tabs', () => {
  assert.deepEqual(DIRECT_ACCESS_NAV_HREFS, ['/ai', '/evidence', '/programs', '/safety', '/sop'])

  for (const href of DIRECT_ACCESS_NAV_HREFS) {
    assert.equal(PRIMARY_NAV_HREFS.includes(href), false)
    assert.equal(MORE_NAV_HREFS.includes(href), false)
    assert.ok(getAllowedNavItems({ role: 'gm' }).some((item) => item.href === href))
  }
})
