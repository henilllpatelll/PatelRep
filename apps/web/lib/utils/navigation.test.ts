import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAllowedNavItems,
  OPERATIONS_HREFS,
  INTELLIGENCE_HREFS,
  PEOPLE_HREFS,
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

test('every allowed href for every role falls within a sidebar group (Pitfall #2)', () => {
  const grouped = new Set([...OPERATIONS_HREFS, ...INTELLIGENCE_HREFS, ...PEOPLE_HREFS, '/settings'])
  const matrix = buildMatrix()
  for (const role of ROLES) {
    const ungrouped = matrix[role].filter((href) => !grouped.has(href))
    assert.deepEqual(ungrouped, [], `role "${role}" has allowed hrefs missing from every sidebar group: ${ungrouped.join(', ')}`)
  }
})
