import assert from 'node:assert/strict'
import test from 'node:test'

import { releaseMetadata } from './release'

test('exposes only a normalized public candidate SHA', () => {
  assert.deepEqual(releaseMetadata('A1B2C3D4E5F6', 'v1.8.0'), {
    fullSha: 'a1b2c3d4e5f6',
    shortSha: 'a1b2c3d',
    version: 'v1.8.0',
  })
})

test('does not expose malformed deployment metadata', () => {
  assert.deepEqual(releaseMetadata('candidate=secret', 'candidate=secret'), {
    fullSha: 'unknown',
    shortSha: 'unknown',
    version: 'unknown',
  })
})

test('defaults version to unknown when unset', () => {
  assert.deepEqual(releaseMetadata('A1B2C3D4E5F6', undefined), {
    fullSha: 'a1b2c3d4e5f6',
    shortSha: 'a1b2c3d',
    version: 'unknown',
  })
})
