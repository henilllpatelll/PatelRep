import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductionRollbackEvidence } from './production-rollback-evidence.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const deps = { resolveTagCommit: async (tag) => tag === 'v1.8.0' ? A : null }

const base = (overrides = {}) => ({
  runId: '37500000001',
  runAttempt: '1',
  controlPlaneSha: C,
  requestedTargetVersion: 'v1.8.0',
  automationSourceRunId: '',
  provenanceResult: 'success',
  preRuntimeResult: 'success',
  preRuntimeStatus: 'proven',
  preRuntimeSha: B,
  preRuntimeVersion: 'v1.8.1',
  resolveResult: 'success',
  resolvedTargetSha: A,
  resolvedTargetVersion: 'v1.8.0',
  compatibilityResult: 'success',
  apiResult: 'success',
  webResult: 'success',
  verifyResult: 'success',
  circuitResult: 'skipped',
  ...overrides,
})

test('manual successful rollback records exact before target and verified after identity', async () => {
  const e = await buildProductionRollbackEvidence(base(), deps)
  assert.equal(e.schema, 'patelrep.production-rollback-evidence.v1')
  assert.equal(e.source.mode, 'manual')
  assert.deepEqual(e.before_runtime, { state: 'proven', sha: B, version: 'v1.8.1' })
  assert.deepEqual(e.target, {
    requested_version: 'v1.8.0',
    requested_version_valid: true,
    resolved: true,
    version: 'v1.8.0',
    sha: A,
  })
  assert.deepEqual(e.after_runtime, { state: 'verified_target', sha: A, version: 'v1.8.0' })
  assert.equal(e.mutations.database, 'not_mutated_by_workflow')
  assert.equal(e.mutations.api, 'deployed_and_verified')
  assert.equal(e.mutations.web, 'deployed_and_verified')
  assert.equal(e.mutations.release_record, 'not_created_by_workflow')
  assert.equal(e.production_verified, true)
  assert.equal(e.quarantine, 'not_applicable')
  assert.equal(e.disposition, 'restored')
})

test('automated successful rollback records incident source and verified quarantine', async () => {
  const e = await buildProductionRollbackEvidence(base({
    automationSourceRunId: '37490000001',
    circuitResult: 'success',
  }), deps)
  assert.equal(e.source.mode, 'automated_incident')
  assert.equal(e.source.automation_source_valid, true)
  assert.equal(e.source.automation_source_run_id, '37490000001')
  assert.equal(e.quarantine, 'verified')
  assert.equal(e.disposition, 'restored')
})

test('pre-runtime identity may be unproven without blocking a valid evidence record', async () => {
  const e = await buildProductionRollbackEvidence(base({
    preRuntimeStatus: 'unproven',
    preRuntimeSha: '',
    preRuntimeVersion: '',
  }), deps)
  assert.deepEqual(e.before_runtime, { state: 'unproven', sha: null, version: null })
  assert.equal(e.disposition, 'restored')
})

test('failed deployment attempts are never guessed safe', async () => {
  const e = await buildProductionRollbackEvidence(base({
    apiResult: 'failure',
    webResult: 'skipped',
    verifyResult: 'skipped',
  }), deps)
  assert.equal(e.mutations.api, 'unknown_after_attempt')
  assert.equal(e.mutations.web, 'not_started')
  assert.deepEqual(e.after_runtime, { state: 'unproven', sha: null, version: null })
  assert.equal(e.disposition, 'failed_or_partial')
})

test('rejected malformed target is sanitized and classified before target resolution', async () => {
  const e = await buildProductionRollbackEvidence(base({
    requestedTargetVersion: 'refs/heads/main',
    resolveResult: 'failure',
    resolvedTargetSha: '',
    resolvedTargetVersion: '',
    compatibilityResult: 'skipped',
    apiResult: 'skipped',
    webResult: 'skipped',
    verifyResult: 'skipped',
  }), { resolveTagCommit: async () => { throw new Error('must not resolve') } })
  assert.equal(e.target.requested_version, null)
  assert.equal(e.target.requested_version_valid, false)
  assert.equal(e.target.resolved, false)
  assert.equal(e.disposition, 'refused_before_target_resolution')
  assert.doesNotMatch(JSON.stringify(e), /refs\/heads\/main/)
})

test('failed automated provenance is recorded without copying malformed source input', async () => {
  const e = await buildProductionRollbackEvidence(base({
    automationSourceRunId: 'token=https://secret.example',
    provenanceResult: 'failure',
    preRuntimeResult: 'skipped',
    preRuntimeStatus: '',
    preRuntimeSha: '',
    preRuntimeVersion: '',
    resolveResult: 'skipped',
    resolvedTargetSha: '',
    resolvedTargetVersion: '',
    compatibilityResult: 'skipped',
    apiResult: 'skipped',
    webResult: 'skipped',
    verifyResult: 'skipped',
    circuitResult: 'skipped',
  }), { resolveTagCommit: async () => { throw new Error('must not resolve') } })
  assert.equal(e.source.automation_source_present, true)
  assert.equal(e.source.automation_source_valid, false)
  assert.equal(e.source.automation_source_run_id, null)
  assert.equal(e.disposition, 'refused_before_production_access')
  assert.doesNotMatch(JSON.stringify(e), /token|https?:\/\/|secret/i)
})

test('successful restore with failed automated quarantine proof is explicit', async () => {
  const e = await buildProductionRollbackEvidence(base({
    automationSourceRunId: '37490000001',
    circuitResult: 'failure',
  }), deps)
  assert.equal(e.production_verified, true)
  assert.equal(e.quarantine, 'unproven')
  assert.equal(e.disposition, 'restored_quarantine_unproven')
})

test('trusted contradictions hard-fail instead of inventing evidence', async () => {
  await assert.rejects(
    buildProductionRollbackEvidence(base({ preRuntimeSha: 'main' }), deps),
    /malformed proven pre-runtime identity/,
  )
  await assert.rejects(
    buildProductionRollbackEvidence(base(), { resolveTagCommit: async () => B }),
    /rollback target tag identity changed/,
  )
  await assert.rejects(
    buildProductionRollbackEvidence(base({ circuitResult: 'success' }), deps),
    /manual rollback unexpectedly ran circuit breaker/,
  )
})
