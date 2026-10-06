import assert from 'node:assert/strict'
import test from 'node:test'
import { captureProductionRollbackRuntime } from './production-rollback-runtime-capture.mjs'

const A = 'a'.repeat(40)

test('captures a valid managed production identity', async () => {
  const result = await captureProductionRollbackRuntime(async () => ({ sha: A, version: 'v1.8.0' }))
  assert.deepEqual(result, { status: 'proven', sha: A, version: 'v1.8.0' })
})

test('unreachable or malformed runtime becomes unproven without leaking error text', async () => {
  const failed = await captureProductionRollbackRuntime(async () => { throw new Error('https://secret.example token=abc') })
  assert.deepEqual(failed, { status: 'unproven', sha: null, version: null })

  const malformed = await captureProductionRollbackRuntime(async () => ({ sha: 'main', version: 'latest' }))
  assert.deepEqual(malformed, { status: 'unproven', sha: null, version: null })

  assert.doesNotMatch(JSON.stringify(failed), /https?:\/\/|token|secret/i)
})
