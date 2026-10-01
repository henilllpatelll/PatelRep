import assert from 'node:assert/strict'
import test from 'node:test'

import { formatStatusTable } from './feature-flag-status.mjs'

test('reports no matching rows plainly', () => {
  assert.equal(formatStatusTable([]), 'No matching rows.')
})

test('renders one row per tenant/feature pair with a header', () => {
  const output = formatStatusTable([
    { tenant_slug: 'austin-test-suites', feature_key: 'staging_flag_demo', enabled: true, updated_at: '2026-10-01T00:00:00Z', updated_by: 'github-actions:feature-rollout:1:henill' },
  ])
  const lines = output.split('\n')
  assert.equal(lines[0], 'tenant_slug | feature_key | enabled | updated_at | updated_by')
  assert.equal(lines[1], 'austin-test-suites | staging_flag_demo | true | 2026-10-01T00:00:00Z | github-actions:feature-rollout:1:henill')
})

test('sorts output deterministically is left to the caller; formatting alone does not reorder', () => {
  const output = formatStatusTable([
    { tenant_slug: 'b-hotel', feature_key: 'x', enabled: false, updated_at: null, updated_by: null },
    { tenant_slug: 'a-hotel', feature_key: 'x', enabled: true, updated_at: null, updated_by: null },
  ])
  const lines = output.split('\n').slice(1)
  assert.equal(lines[0].startsWith('b-hotel'), true)
  assert.equal(lines[1].startsWith('a-hotel'), true)
})
