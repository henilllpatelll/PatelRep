import assert from 'node:assert/strict'
import test from 'node:test'

import { visibleEnvironmentLabel } from './environment'

test('shows a staging identity only in staging', () => {
  assert.equal(visibleEnvironmentLabel('staging'), 'STAGING')
  assert.equal(visibleEnvironmentLabel('production'), null)
  assert.equal(visibleEnvironmentLabel('development'), null)
})
