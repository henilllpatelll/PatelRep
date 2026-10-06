import assert from 'node:assert/strict'
import test from 'node:test'
import { RATE_LIMITED_CONSOLE_ERROR as E, filterTransientRateLimits } from './smokeFailures'

test('drops a console 429 matched by an observed GET 429', () => {
  assert.deepEqual(filterTransientRateLimits([E], [{ method: 'GET' }]), [])
})

test('keeps a console 429 with no observed rate-limited response', () => {
  assert.deepEqual(filterTransientRateLimits([E], []), [E])
})

test('keeps console 429s from write requests', () => {
  assert.deepEqual(filterTransientRateLimits([E], [{ method: 'POST' }]), [E])
})

test('only tolerates as many console 429s as observed GET 429s and keeps other errors', () => {
  assert.deepEqual(
    filterTransientRateLimits([E, E, '500 https://x/y'], [{ method: 'GET' }]),
    [E, '500 https://x/y'],
  )
})
