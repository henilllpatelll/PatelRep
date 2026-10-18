import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFixtureAuthAttributes } from './regression-fixture-auth.mjs'

test('regression fixture users receive service-managed hotel and role claims', () => {
  const users = [
    { fullName: 'Regression Fixture GM', role: 'gm' },
    {
      fullName: 'Regression Fixture Supervisor',
      role: 'housekeeping_supervisor',
    },
  ]

  for (const user of users) {
    const attributes = buildFixtureAuthAttributes({
      hotelId: 'fixture-hotel',
      ...user,
    })

    assert.deepEqual(attributes.app_metadata, {
      hotel_id: 'fixture-hotel',
      role: user.role,
    })
    assert.deepEqual(attributes.user_metadata, {
      hotel_id: 'fixture-hotel',
      full_name: user.fullName,
    })
  }
})
